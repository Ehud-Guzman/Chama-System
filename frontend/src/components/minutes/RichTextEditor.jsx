import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import './minutes.css';
import { toEditorHtml } from './richText';

// Re-exported so existing imports of toEditorHtml from this module keep working.
export { toEditorHtml };

// 44px square: this is a touch toolbar first and a mouse toolbar second, and the
// twelve buttons used to be 40px, which is under both platform minimums.
const TOOLBAR_BTN = 'min-h-11 min-w-11 rounded-lg px-2.5 text-sm font-bold text-ink hover:bg-primary/10 aria-pressed:bg-primary aria-pressed:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

const TOOLBAR_DIVIDER = 'h-6 w-px bg-rule';

function ToolbarButton({ onClick, active, disabled, label, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={!!active}
      aria-label={label}
      title={label}
      className={TOOLBAR_BTN}
    >
      {icon ? <span className="text-base leading-none">{icon}</span> : children}
    </button>
  );
}

function ToolbarGroup({ children }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function Toolbar({ editor }) {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-t-xl border border-b-0 border-rule bg-canvas px-2 py-1.5">
      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <span className="line-through">S</span>
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-rule" />
      <ToolbarButton
        label="Heading"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        label="Subheading"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H2
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-rule" />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •—
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        “”
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-rule" />
      <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        ↶
      </ToolbarButton>
      <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        ↷
      </ToolbarButton>
    </div>
  );
}

export default function RichTextEditor({ value, onChange, placeholder }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        hardBreak: {
          keepMarks: true,
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start typing…',
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    content: toEditorHtml(value),
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    editorProps: {
      attributes: {
        class:
          'minute-editor min-h-96 rounded-b-xl border border-rule bg-white px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30',
      },
      handlePaste: (view, event) => {
        return false;
      },
    },
  });

  return (
    <div className="rounded-xl overflow-hidden border border-rule">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
