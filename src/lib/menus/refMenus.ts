// Centralized context-menu builders for refs (branches/tags) and commits.
// Each builder returns a MenuItem[] that can be passed straight to openMenu.
//
// Some entries trigger features we haven't implemented yet (Pin to Left,
// Solo, Cloud Patch, GitHub PR review, etc.). These are wired to a single
// "stub" handler that logs to the application Logs panel — visible to the
// user — so the menu is fully populated and we can fill in real behavior
// incrementally without changing call sites.
//
// Implementations live in branchMenus, tagMenus, commitMenus and menuActions;
// this module only re-exports the public builders so call sites keep one import path.

export { localBranchMenu, remoteBranchMenu } from "$lib/menus/branchMenus";
export { tagMenu, tagExistsOnOrigin, refreshRemoteTags } from "$lib/menus/tagMenus";
export { commitMenu } from "$lib/menus/commitMenus";
