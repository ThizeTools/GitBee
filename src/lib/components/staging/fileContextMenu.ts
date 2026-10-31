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
      ? { label: "Unstage File", icon: "remove", onClick: () => unstageFile(path) }
      : { label: "Stage File", icon: "add", onClick: () => stageFile(path) },
    { label: "Discard Changes", icon: "undo", danger: true, onClick: () => discardFile(path) },
    { separator: true, label: "" },
    {
      label: "Ignore",
      icon: "eye-off",
      submenu: [
        { label: `Ignore "${path}"`, onClick: () => addIgnore(path) },
        fileExtension(path)
          ? { label: `All files with the extension "${fileExtension(path)}"`, onClick: () => addIgnore(`*${fileExtension(path)}`) }
          : { label: "(no file extension)", disabled: true },
      ],
    },
    { label: "Stash File", icon: "stash", onClick: () => stashOneFile(path) },
    { label: "File History", icon: "history", onClick: () => fileHistory(path) },
    { separator: true, label: "" },
    { label: "File Blame", icon: "blame",onClick: () => fileBlame(path) },
    { label: "Show in folder", icon: "folder", onClick: () => showInFolder(path) },
    { label: "Copy file path", icon: "copy", onClick: () => copyPath(path) },
    { label: "Edit file", icon: "file-modified", onClick: () => editFile(path) },
    { separator: true, label: "" },
    { label: "Delete file", icon: "trash", danger: true, onClick: () => deleteFile(path) },
  ];
}
