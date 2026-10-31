//! Turns raw PTY bytes into UTF-8 text chunks for the frontend.
//!
//! WHY a stateful chunker: a read can end in the middle of a multibyte
//! character. Decoding each read on its own would turn that character into two
//! U+FFFD replacement characters, so the incomplete tail waits for the next read.

/// Largest text chunk sent in one event. Bounds the IPC payload size.
pub const MAX_CHUNK_BYTES: usize = 16 * 1024;

const REPLACEMENT: &str = "\u{FFFD}";

/// Holds an incomplete UTF-8 tail between reads.
#[derive(Default)]
pub struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    /// Feeds raw bytes and returns the text that is complete so far.
    /// Invalid bytes become U+FFFD; an incomplete tail is kept for the next call.
    /// Example: push(&[0xC3]) is empty, then push(&[0xA9]) yields ["é"].
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            match decode_prefix(&self.pending) {
                Decoded::Complete(text) => {
                    out.extend(split_text(&text));
                    self.pending.clear();
                    return out;
                }
                Decoded::Invalid { valid, text, bad_len } => {
                    out.extend(split_text(&text));
                    out.push(REPLACEMENT.to_string());
                    self.pending.drain(..valid + bad_len);
                }
                Decoded::Incomplete { valid, text } => {
                    out.extend(split_text(&text));
                    self.pending.drain(..valid);
                    return out;
                }
            }
        }
    }

    /// Flushes bytes still held at end of stream, decoded lossily.
    pub fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            return None;
        }
        let rest = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        Some(rest)
    }
}

/// One step of decoding: the valid text before the first problem, and what
/// the problem is.
enum Decoded {
    Complete(String),
    Invalid { valid: usize, text: String, bad_len: usize },
    Incomplete { valid: usize, text: String },
}

fn decode_prefix(bytes: &[u8]) -> Decoded {
    match std::str::from_utf8(bytes) {
        Ok(text) => Decoded::Complete(text.to_string()),
        Err(err) => classify(bytes, err),
    }
}

fn classify(bytes: &[u8], err: std::str::Utf8Error) -> Decoded {
    let valid = err.valid_up_to();
    // valid_up_to marks a prefix that from_utf8 has already proven valid.
    let text = String::from_utf8_lossy(&bytes[..valid]).into_owned();
    match err.error_len() {
        Some(bad_len) => Decoded::Invalid { valid, text, bad_len },
        None => Decoded::Incomplete { valid, text },
    }
}

/// Splits text into pieces of at most MAX_CHUNK_BYTES, cutting only on char boundaries.
fn split_text(mut text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    while !text.is_empty() {
        let cut = boundary_within(text, MAX_CHUNK_BYTES);
        parts.push(text[..cut].to_string());
        text = &text[cut..];
    }
    parts
}

/// Largest index <= max that is a char boundary. UTF-8 chars are at most 4
/// bytes, so the walk back is short and never reaches zero for max >= 4.
fn boundary_within(text: &str, max: usize) -> usize {
    if text.len() <= max {
        return text.len();
    }
    let mut cut = max;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(parts: &[String]) -> String {
        parts.concat()
    }

    #[test]
    fn multibyte_char_split_across_reads_is_kept_whole() {
        let mut chunker = Utf8Chunker::default();
        assert!(chunker.push(&[0xC3]).is_empty());
        assert_eq!(chunker.push(&[0xA9]), vec!["é".to_string()]);
    }

    #[test]
    fn invalid_byte_becomes_replacement_char() {
        let mut chunker = Utf8Chunker::default();
        let out = chunker.push(&[b'a', 0xFF, b'b']);
        assert_eq!(joined(&out), "a\u{FFFD}b");
    }

    #[test]
    fn incomplete_tail_is_flushed_lossily_at_end() {
        let mut chunker = Utf8Chunker::default();
        assert!(chunker.push(&[b'x', 0xE2, 0x82]).iter().all(|s| s == "x"));
        assert_eq!(chunker.finish(), Some("\u{FFFD}".to_string()));
        assert_eq!(chunker.finish(), None);
    }

    #[test]
    fn long_text_is_split_into_bounded_chunks() {
        let mut chunker = Utf8Chunker::default();
        let text = "y".repeat(MAX_CHUNK_BYTES * 2 + 10);
        let out = chunker.push(text.as_bytes());
        assert_eq!(out.len(), 3);
        assert!(out.iter().all(|s| s.len() <= MAX_CHUNK_BYTES));
        assert_eq!(joined(&out), text);
    }

    #[test]
    fn split_never_cuts_inside_a_char() {
        // 3-byte chars: a 16 KB cut lands mid-char unless it walks back.
        let text = "€".repeat(MAX_CHUNK_BYTES);
        let parts = split_text(&text);
        assert!(parts.iter().all(|p| p.len() <= MAX_CHUNK_BYTES));
        assert_eq!(joined(&parts), text);
    }
}
