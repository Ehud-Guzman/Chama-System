import { lazy } from 'react';

// The minute reader is the rich-text editor's parser and schema. Loading it with
// the page put Tiptap and ProseMirror (~180 KB gzip) in the members' page bundle
// for everyone who ever opens a link — most of whom come to see a balance. It now
// arrives only when a member actually opens a minute.
export const MinutesReader = lazy(() => import('../../minutes/MinutesReader'));
