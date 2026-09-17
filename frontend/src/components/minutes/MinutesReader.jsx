import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { toEditorHtml } from './RichTextEditor';

// Read-only view of a saved minute. It deliberately renders through the same
// Tiptap schema the editor writes with: anything outside that schema (a
// <script>, an iframe, an onclick pasted in from elsewhere) simply isn't part of
// the document model, so it can never reach the DOM. No separate HTML sanitiser
// to keep in step with the editor.
//
// Callers must pass a `key` tied to the minute's id — `useEditor` takes its
// content once at mount, which is exactly what we want here (one minute per
// mount) but means switching minutes needs a fresh mount.
export default function MinutesReader({ content }) {
  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({
        hardBreak: {
          keepMarks: true,
        },
      }),
      Underline,
      Link.configure({
        openOnClick: true,
        autolink: true,
      }),
    ],
    content: toEditorHtml(content),
    editorProps: {
      attributes: {
        class: 'minute-editor text-sm leading-relaxed focus:outline-none',
      },
    },
  });

  return <EditorContent editor={editor} />;
}