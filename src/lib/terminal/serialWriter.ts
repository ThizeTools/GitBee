// Runs input writes one after another. Each keystroke is a separate IPC call,
// and Tauri may run calls out of order, which would scramble typed text. A
// failed write is reported through `onError` and does not stop the queue.

export type WriteFn = (id: number, data: string) => Promise<void>;

/** Returns a function that queues writes behind the previous one.
 * Example: const send = createSerialWriter(ipcWrite, logError); send(3, "ls\r") */
export function createSerialWriter(
  write: WriteFn,
  onError: (message: string) => void,
): (id: number, data: string) => void {
  let queue: Promise<void> = Promise.resolve();
  return (id, data) => {
    queue = queue.then(() => runWrite(write, id, data, onError));
  };
}

async function runWrite(
  write: WriteFn,
  id: number,
  data: string,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await write(id, data);
  } catch (err) {
    onError(`terminal input to session ${id}: ${err}`);
  }
}
