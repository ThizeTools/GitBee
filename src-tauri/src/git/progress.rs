//! Pure rules for git's progress output: a line parser, a stream splitter and
//! a rate limiter. No I/O lives here, so every rule is unit tested without a
//! git process. See docs/specs/git-progress.md for the contract.

use std::time::{Duration, Instant};

/// Minimum gap between two progress events of one operation. Git can redraw
/// its progress line hundreds of times a second on a big push; the window
/// needs about ten updates a second, so this keeps IPC and re-renders bounded.
pub const PROGRESS_MIN_GAP: Duration = Duration::from_millis(100);

/// Longest phase name accepted. Real git phases are under 30 characters; the
/// cap rejects long prose that merely contains a colon.
const MAX_PHASE_LEN: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgressLine {
    pub phase: String,
    pub percent: Option<u8>,
    pub done: Option<u64>,
    pub total: Option<u64>,
}

/// Parses one git progress segment. Returns `None` for anything that is not
/// progress (URLs, `error:` lines, `Total ...` summaries), so every stderr
/// segment can be fed through it unfiltered.
///
/// `Receiving objects:  45% (450/1000), 1.2 MiB` gives phase "Receiving
/// objects", 45%, 450 of 1000. `remote: Enumerating objects: 5, done.` gives
/// phase "Enumerating objects" with 5 done and no total.
pub fn parse_progress(line: &str) -> Option<ProgressLine> {
    let body = strip_remote_prefix(line.trim());
    let (phase, rest) = body.split_once(':')?;
    let phase = phase.trim();
    if !is_phase_name(phase) {
        return None;
    }
    let (percent, done, total) = parse_figures(rest.trim_start())?;
    Some(ProgressLine { phase: phase.to_string(), percent, done, total })
}

// Sideband lines from a remote arrive as `remote: <text>`; the prefix is not
// part of the phase name.
fn strip_remote_prefix(line: &str) -> &str {
    line.strip_prefix("remote:").map(str::trim_start).unwrap_or(line)
}

fn is_phase_name(phase: &str) -> bool {
    !phase.is_empty()
        && phase.len() <= MAX_PHASE_LEN
        && phase.chars().all(|c| c.is_ascii_alphabetic() || c == ' ')
}

type Figures = (Option<u8>, Option<u64>, Option<u64>);

// Accepts only the two shapes git prints. Anything else after the colon
// (`https://…`, `3 refs failed`) is not progress.
fn parse_figures(s: &str) -> Option<Figures> {
    let (number, tail) = take_number(s)?;
    match tail.strip_prefix('%') {
        Some(after) => parse_percent_figures(number, after),
        None => parse_count_only(number, tail),
    }
}

fn parse_percent_figures(number: u64, after: &str) -> Option<Figures> {
    let percent = u8::try_from(number).ok().filter(|p| *p <= 100)?;
    if !(after.is_empty() || after.starts_with(|c: char| c == ' ' || c == ',')) {
        return None;
    }
    let (done, total) = match parse_fraction(after) {
        Some((d, t)) => (Some(d), Some(t)),
        None => (None, None),
    };
    Some((Some(percent), done, total))
}

// Object counts that have no total, as in `Enumerating objects: 5, done.`
fn parse_count_only(number: u64, tail: &str) -> Option<Figures> {
    if !(tail.is_empty() || tail.starts_with(',')) {
        return None;
    }
    Some((None, Some(number), None))
}

// `(450/1000)` after the percent. Returns None when the parenthesis is absent.
fn parse_fraction(s: &str) -> Option<(u64, u64)> {
    let inner = s.trim_start().strip_prefix('(')?;
    let (done, tail) = take_number(inner)?;
    let (total, _) = take_number(tail.strip_prefix('/')?)?;
    Some((done, total))
}

// Leading ASCII digits and the rest of the string. A value too large for u64
// is rejected rather than wrapped.
fn take_number(s: &str) -> Option<(u64, &str)> {
    let digits = s.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return None;
    }
    let value = s[..digits].parse::<u64>().ok()?;
    Some((value, &s[digits..]))
}

/// Splits a byte stream on `\r` and `\n`. Git redraws its progress line with a
/// bare `\r`, so splitting on `\n` alone would deliver one huge segment for
/// the whole operation and no updates until it ended.
#[derive(Debug, Default)]
pub struct SegmentSplitter {
    pending: Vec<u8>,
}

impl SegmentSplitter {
    pub fn feed(&mut self, chunk: &[u8], mut on_segment: impl FnMut(&[u8])) {
        for &byte in chunk {
            if byte == b'\r' || byte == b'\n' {
                on_segment(&self.pending);
                self.pending.clear();
            } else {
                self.pending.push(byte);
            }
        }
    }

    /// Emits the unterminated tail left when the stream ends.
    pub fn finish(&mut self, mut on_segment: impl FnMut(&[u8])) {
        if !self.pending.is_empty() {
            on_segment(&self.pending);
            self.pending.clear();
        }
    }
}

/// Allows at most one event per `min_gap`. Takes the clock as a parameter so
/// tests can drive it with explicit instants instead of sleeping.
#[derive(Debug)]
pub struct Throttle {
    min_gap: Duration,
    last_allowed: Option<Instant>,
}

impl Throttle {
    pub fn new(min_gap: Duration) -> Self {
        Self { min_gap, last_allowed: None }
    }

    /// True when an event at `now` may be sent; records it as sent.
    pub fn allow(&mut self, now: Instant) -> bool {
        let due = match self.last_allowed {
            None => true,
            Some(prev) => now.saturating_duration_since(prev) >= self.min_gap,
        };
        if due {
            self.last_allowed = Some(now);
        }
        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(line: &str) -> ProgressLine {
        parse_progress(line).unwrap_or_else(|| panic!("expected progress, got None for {line:?}"))
    }

    #[test]
    fn parses_receiving_objects_with_percent_counts_and_rate() {
        let p = parsed("Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s");
        assert_eq!(p.phase, "Receiving objects");
        assert_eq!(p.percent, Some(45));
        assert_eq!(p.done, Some(450));
        assert_eq!(p.total, Some(1000));
    }

    #[test]
    fn parses_resolving_deltas_at_one_hundred_percent() {
        let p = parsed("Resolving deltas: 100% (10/10), done.");
        assert_eq!(p.phase, "Resolving deltas");
        assert_eq!(p.percent, Some(100));
        assert_eq!((p.done, p.total), (Some(10), Some(10)));
    }

    #[test]
    fn strips_the_remote_sideband_prefix() {
        let p = parsed("remote: Counting objects: 12% (1/8)");
        assert_eq!(p.phase, "Counting objects");
        assert_eq!(p.percent, Some(12));
        assert_eq!((p.done, p.total), (Some(1), Some(8)));
    }

    #[test]
    fn parses_writing_objects_with_leading_spaces_in_the_figures() {
        let p = parsed("Writing objects:  50% (2/4)");
        assert_eq!(p.phase, "Writing objects");
        assert_eq!(p.percent, Some(50));
        assert_eq!((p.done, p.total), (Some(2), Some(4)));
    }

    #[test]
    fn parses_enumerating_as_a_count_without_percent_or_total() {
        let p = parsed("Enumerating objects: 5, done.");
        assert_eq!(p.phase, "Enumerating objects");
        assert_eq!(p.percent, None);
        assert_eq!(p.done, Some(5));
        assert_eq!(p.total, None);
    }

    #[test]
    fn parses_a_percent_without_a_fraction() {
        let p = parsed("Receiving objects: 45%");
        assert_eq!(p.percent, Some(45));
        assert_eq!((p.done, p.total), (None, None));
    }

    #[test]
    fn rejects_lines_that_are_not_progress() {
        let junk = [
            "",
            "   ",
            "To https://github.com/o/r.git",
            "From github.com:o/r",
            "error: failed to push some refs",
            "error: 3 refs failed",
            "Total 4 (delta 2), reused 0 (delta 0), pack-reused 0",
            "Cloning into 'repo'...",
            "! [rejected]        main -> main (non-fast-forward)",
            "remote: ",
        ];
        for line in junk {
            assert!(parse_progress(line).is_none(), "junk line parsed as progress: {line:?}");
        }
    }

    #[test]
    fn rejects_a_percent_above_one_hundred() {
        assert!(parse_progress("Receiving objects: 150% (1/2)").is_none());
    }

    #[test]
    fn rejects_a_count_too_large_for_u64() {
        assert!(parse_progress("Receiving objects: 99999999999999999999999 items").is_none());
    }

    #[test]
    fn splitter_breaks_on_carriage_return_and_newline() {
        let mut splitter = SegmentSplitter::default();
        let mut seen: Vec<String> = Vec::new();
        splitter.feed(b"a\rb\nc\r\n", |seg| seen.push(String::from_utf8_lossy(seg).into_owned()));
        assert_eq!(seen, ["a", "b", "c", ""]);
    }

    #[test]
    fn splitter_keeps_a_segment_split_across_chunks() {
        let mut splitter = SegmentSplitter::default();
        let mut seen: Vec<String> = Vec::new();
        splitter.feed(b"Recei", |_| {});
        splitter.feed(b"ving\r", |seg| seen.push(String::from_utf8_lossy(seg).into_owned()));
        assert_eq!(seen, ["Receiving"]);
    }

    #[test]
    fn splitter_emits_an_unterminated_tail_only_on_finish() {
        let mut splitter = SegmentSplitter::default();
        let mut seen: Vec<String> = Vec::new();
        splitter.feed(b"tail", |seg| seen.push(String::from_utf8_lossy(seg).into_owned()));
        assert!(seen.is_empty());
        splitter.finish(|seg| seen.push(String::from_utf8_lossy(seg).into_owned()));
        assert_eq!(seen, ["tail"]);
    }

    #[test]
    fn throttle_allows_the_first_event_and_drops_events_inside_the_gap() {
        let mut throttle = Throttle::new(PROGRESS_MIN_GAP);
        let t0 = Instant::now();
        assert!(throttle.allow(t0));
        assert!(!throttle.allow(t0 + Duration::from_millis(40)));
        assert!(!throttle.allow(t0 + Duration::from_millis(99)));
    }

    #[test]
    fn throttle_allows_again_once_the_gap_has_passed() {
        let mut throttle = Throttle::new(PROGRESS_MIN_GAP);
        let t0 = Instant::now();
        assert!(throttle.allow(t0));
        assert!(throttle.allow(t0 + PROGRESS_MIN_GAP));
        assert!(!throttle.allow(t0 + PROGRESS_MIN_GAP + Duration::from_millis(10)));
    }
}
