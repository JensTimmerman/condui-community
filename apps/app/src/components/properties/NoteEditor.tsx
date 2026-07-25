/**
 * TipTap-based rich text editor for notes.
 * Supports bold, italic, underline, and font size. Content is stored as HTML.
 */

import { useEffect, useCallback, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import { markdownToHtml } from '@/utils/noteHtml'
import CustomDropdown from '@/components/common/CustomDropdown'

/** Heuristic: content is legacy markdown if it's not empty and doesn't look like HTML */
function isLegacyMarkdown(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.startsWith('<') && (t.startsWith('<p>') || t.startsWith('<div') || t.startsWith('<span'))) return false
  return true
}

function toEditorHtml(text: string, defaultFontSize: number): string {
  if (!text.trim()) return '<p></p>'
  if (isLegacyMarkdown(text)) {
    const withBr = markdownToHtml(text, defaultFontSize)
    const lines = withBr.split('<br>')
    return lines.map((line) => `<p>${line || '<br>'}</p>`).join('')
  }
  return text
}

export interface NoteEditorProps {
  /** Current note HTML or legacy markdown (converted on first load) */
  content: string
  defaultFontSize: number
  onUpdate: (html: string) => void
  className?: string
}

export function NoteEditor({ content, defaultFontSize, onUpdate, className = '' }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable heading and other block features we don't need
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        code: false,
      }),
      Underline,
      TextStyle,
      FontSize,
    ],
    content: toEditorHtml(content, defaultFontSize),
    editorProps: {
      attributes: {
        style: `font-size: ${defaultFontSize}px; white-space: pre-wrap; word-break: break-word;`,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onUpdate(html)
    },
  })

  // Sync content when switching to another note (e.g. different noteId)
  useEffect(() => {
    if (!editor) return
    const nextHtml = toEditorHtml(content, defaultFontSize)
    if (editor.getHTML() !== nextHtml) {
      editor.commands.setContent(nextHtml, { emitUpdate: false })
    }
  }, [editor, content, defaultFontSize])

  // Force re-render when selection/cursor changes so B/I/U and font size dropdown reflect current state
  const [, setSelectionTick] = useState(0)
  const selectionRef = useRef<{ from: number; to: number } | null>(null)

  useEffect(() => {
    if (!editor) return
    const onUpdate = () => {
      selectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to }
      setSelectionTick((t) => t + 1)
    }
    editor.on('selectionUpdate', onUpdate)
    editor.on('transaction', onUpdate)
    return () => {
      editor.off('selectionUpdate', onUpdate)
      editor.off('transaction', onUpdate)
    }
  }, [editor])

  const activeClass = 'bg-sky-500 text-white border-sky-600'
  const inactiveClass = 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
  const btnClass = 'px-3 py-2 border rounded-md font-normal'

  const setFontSize = useCallback(
    (size: number) => {
      if (!editor) return
      const sel = selectionRef.current
      const chain = editor.chain().focus()
      if (sel && (sel.from !== sel.to || sel.from >= 0)) {
        chain.setTextSelection(sel).setFontSize(`${size}px`).run()
      } else {
        chain.setFontSize(`${size}px`).run()
      }
    },
    [editor]
  )

  if (!editor) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${btnClass} font-bold ${editor.isActive('bold') ? activeClass : inactiveClass}`}
          title="Bold"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${btnClass} italic ${editor.isActive('italic') ? activeClass : inactiveClass}`}
          title="Italic"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`${btnClass} underline ${editor.isActive('underline') ? activeClass : inactiveClass}`}
          title="Underline"
        >
          U
        </button>
        <div className="flex-1" />
        <CustomDropdown
          value={(() => {
            const v = editor.getAttributes('textStyle').fontSize
            if (typeof v === 'string' && /^\d+px$/.test(v)) return v.replace('px', '')
            return String(defaultFontSize)
          })()}
          onChange={(v) => {
            if (v) setFontSize(parseInt(v, 10))
          }}
          options={[2, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map((size) => ({
            value: String(size),
            label: `${size}px`,
          }))}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          onPointerDown={() => {
            // Keep editor selection in ref before the control steals focus so onChange can apply size to it.
            selectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to }
          }}
        />
      </div>
      <EditorContent
        editor={editor}
        className={
          className +
          ' min-h-[120px] max-h-[300px] overflow-y-auto rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white focus-within:ring-2 focus-within:ring-sky-500 [&_.ProseMirror]:min-h-[100px] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:mb-1 [&_.ProseMirror_p:last-child]:mb-0'
        }
      />
    </div>
  )
}
