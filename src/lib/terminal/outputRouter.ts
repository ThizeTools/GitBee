// Routes session output to the xterm surface that shows it. Output can arrive
// before the surface exists (the spawn call returns after the shell has
// already printed its prompt), so it waits in a bounded backlog until a sink attaches.

import { appendCapped, BACKLOG_LIMIT_CHARS } from "./sessions";

export type OutputSink = (data: string) => void;

export class OutputRouter {
  private readonly sinks = new Map<number, OutputSink>();
  private readonly backlog = new Map<number, string>();

  constructor(private readonly backlogLimit: number = BACKLOG_LIMIT_CHARS) {}

  /** Sends output to `sink` now, and any backlog kept for `id` first. */
  attach(id: number, sink: OutputSink): void {
    this.sinks.set(id, sink);
    const waiting = this.backlog.get(id);
    if (waiting === undefined) return;
    this.backlog.delete(id);
    sink(waiting);
  }

  /** Stops delivery to the sink. Later output waits in the backlog. */
  detach(id: number): void {
    this.sinks.delete(id);
  }

  /** Sends output to the attached sink, or keeps it in the backlog. */
  deliver(id: number, data: string): void {
    const sink = this.sinks.get(id);
    if (sink) {
      sink(data);
      return;
    }
    const kept = this.backlog.get(id) ?? "";
    this.backlog.set(id, appendCapped(kept, data, this.backlogLimit));
  }

  /** Forgets a session entirely, sink and backlog both. */
  drop(id: number): void {
    this.sinks.delete(id);
    this.backlog.delete(id);
  }
}
