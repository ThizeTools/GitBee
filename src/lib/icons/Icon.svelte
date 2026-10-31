<script lang="ts">
  /**
   * The only module that imports @lucide/svelte. Components render
   * `<Icon name="pull" />` and never import the package (spec: "Icons",
   * docs/specs/ui-layout-2026-11.md).
   *
   * Named imports (not `import * as`) keep the bundle to the glyphs in the
   * table below: a dynamic lookup into the namespace would pull in the whole
   * ~1900-icon set.
   *
   * The table is typed `Record<UsedLucideName, LucideIcon>`, so a Lucide name
   * added to names.ts without an import here fails `bun run check`.
   *
   * Usage: <Icon name="warning" size={14} title="Conflicts" />
   */
  import {
    Undo2,
    Redo2,
    ArrowDownToLine,
    ArrowUpFromLine,
    RefreshCw,
    GitBranch,
    GitMerge,
    Archive,
    ArchiveRestore,
    SquareTerminal,
    Search,
    Command,
    Palette,
    Settings,
    Ellipsis,
    EllipsisVertical,
    ChevronRight,
    ChevronDown,
    X,
    Plus,
    Minus,
    Check,
    TriangleAlert,
    Info,
    Trash,
    Eye,
    EyeOff,
    Pin,
    Tag,
    Cloud,
    Laptop,
    Folder,
    FolderGit,
    File,
    FilePlus,
    FileMinus,
    FilePen,
    FileSymlink,
    FileExclamationPoint,
    RotateCcwClock,
    User,
    Users,
    Lock,
    Sparkles,
    Keyboard,
    ScrollText,
    ZoomIn,
    Download,
    GitPullRequest,
    GitCommitHorizontal,
    Package,
    HardDrive,
    Copy,
    ExternalLink,
    Funnel,
    Star,
    House,
    LogOut,
    Upload,
    GripVertical,
    ArrowLeft,
    ArrowRight,
    ChevronUp,
    ChevronLeft,
    ArrowDownAZ,
    FileUser,
    RotateCcw,
    Cherry,
    ArrowRightLeft,
    type LucideIcon,
  } from "@lucide/svelte";
  import {
    ICON_LUCIDE_NAMES,
    type IconName,
    type UsedLucideName,
  } from "./names";

  interface IconProps {
    /** Action name from names.ts; the map decides which glyph renders. */
    name: IconName;
    /** Pixel size of the square SVG. */
    size?: number;
    /** Stroke width; the spec default is 1.75. */
    strokeWidth?: number;
    /** Accessible label. Without it the icon is decorative (aria-hidden). */
    title?: string;
    /** Extra classes on the <svg>. */
    class?: string;
  }

  const COMPONENTS: Record<UsedLucideName, LucideIcon> = {
    Undo2,
    Redo2,
    ArrowDownToLine,
    ArrowUpFromLine,
    RefreshCw,
    GitBranch,
    GitMerge,
    Archive,
    ArchiveRestore,
    SquareTerminal,
    Search,
    Command,
    Palette,
    Settings,
    Ellipsis,
    EllipsisVertical,
    ChevronRight,
    ChevronDown,
    X,
    Plus,
    Minus,
    Check,
    TriangleAlert,
    Info,
    Trash,
    Eye,
    EyeOff,
    Pin,
    Tag,
    Cloud,
    Laptop,
    Folder,
    FolderGit,
    File,
    FilePlus,
    FileMinus,
    FilePen,
    FileSymlink,
    FileExclamationPoint,
    RotateCcwClock,
    User,
    Users,
    Lock,
    Sparkles,
    Keyboard,
    ScrollText,
    ZoomIn,
    Download,
    GitPullRequest,
    GitCommitHorizontal,
    Package,
    HardDrive,
    Copy,
    ExternalLink,
    Funnel,
    Star,
    House,
    LogOut,
    Upload,
    GripVertical,
    ArrowLeft,
    ArrowRight,
    ChevronUp,
    ChevronLeft,
    ArrowDownAZ,
    FileUser,
    RotateCcw,
    Cherry,
    ArrowRightLeft,
  };

  let {
    name,
    size = 16,
    strokeWidth = 1.75,
    title,
    class: className = "",
  }: IconProps = $props();

  const Glyph = $derived(COMPONENTS[ICON_LUCIDE_NAMES[name]]);
</script>

<!--
  aria-hidden is passed explicitly for title-less icons. Lucide sets it only
  when no aria-* prop is present, and the aria-label key below is always
  present, so Lucide would never add it.
-->
<Glyph
  {size}
  {strokeWidth}
  color="currentColor"
  class={className}
  style="display: inline-block; vertical-align: -0.15em; flex-shrink: 0;"
  role={title ? "img" : undefined}
  aria-label={title}
  aria-hidden={title ? undefined : "true"}
/>
