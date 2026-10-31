import type { MenuItem } from "$lib/stores/contextmenu";
import {
  addIgnore,
  copyPath,
  deleteFile,
  discardFile,
  editFile,
  fileBlame,
  fileHistory,
  showInFolder,
  stageFile,
  stashOneFile,
  unstageFile,
} from "./fileActions";
import { fileExtension } from "./stagingHelpers";

/**
 * Right-click menu for one file row (#13). `staged` picks between Unstage and
 * Stage as the first item, since a row only ever offers its own direction.
 *
 * @example fileContextMenu("src/a.ts", true)[0].label // "Unstage File"
 */
export function fileContextMenu(path: string, staged: boolean): MenuItem[] {
  return [
    staged
      ? { label: "Unstage File", icon: "−", onClick: () => unstageFile(path) }
      : { label: "Stage File", icon: "+", onClick: () => stageFile(path) },
    { label: "Discard Changes", icon: "↺", danger: true, onClick: () => discardFile(path) },
    { separator: true, label: "" },
    {
      label: "Ignore",
      icon: "⊘",
      submenu: [
        { label: `Ignore "${path}"`, onClick: () => addIgnore(path) },
        fileExtension(path)
          ? { label: `All files with the extension "${fileExtension(path)}"`, onClick: () => addIgnore(`*${fileExtension(path)}`) }
          : { label: "(no file extension)", disabled: true },
      ],
    },
    { label: "Stash File", icon: "⛶", onClick: () => stashOneFile(path) },
    { label: "File History", icon: "🕮", onClick: () => fileHistory(path) },
    { separator: true, label: "" },
    { label: "File Blame", icon: "≡", onClick: () => fileBlame(path) },
    { label: "Show in folder", icon: "📂", onClick: () => showInFolder(path) },
    { label: "Copy file path", icon: "⧉", onClick: () => copyPath(path) },
    { label: "Edit file", icon: "✎", onClick: () => editFile(path) },
    { separator: true, label: "" },
    { label: "Delete file", icon: "🗑", danger: true, onClick: () => deleteFile(path) },
  ];
}
