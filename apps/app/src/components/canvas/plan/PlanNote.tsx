import { useCallback, useMemo } from 'react'
import { Group, Text, Rect } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useThemeColors } from '@/lib/theme/hooks'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useCanvasFontFamily, useClearSelectionStore, useSetSelectionStore } from '@/editions/community/communityHooks'
import { useUIStore } from '@/stores/uiStore'
import { noteCanvasChromePadding, noteContentToLines } from '@/utils/noteMarkdown'
import type { Note } from '@/types/schema'

type NotePointerEvent = KonvaEventObject<MouseEvent | TouchEvent>
type NoteDragEvent = KonvaEventObject<DragEvent>
type WindowWithEendraTapSuppression = Window & {
  __eendraSuppressNextElementTap?: boolean
}

interface PlanNoteProps {
  note: Note
  onDragEnd?: (noteId: string, newPos: { x: number; y: number }) => void
  onDragMove?: (noteId: string, newPos: { x: number; y: number }) => void
  interactive?: boolean
}

export function PlanNote({ note, onDragEnd, onDragMove, interactive = true }: PlanNoteProps) {
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const setSelection = useSetSelectionStore()
  const clearSelection = useClearSelectionStore()
  const isSelected = useStoreWithEqualityFn(
    useUIStore,
    (s) => s.selection.type === 'note' && s.selection.ids.includes(note.id),
    (a, b) => a === b,
  )
  
  // Text color - black for light mode, white for dark mode
  const textColor = colors.textColor
  
  // Parse markdown and calculate dimensions
  const { parsedLines, textWidth, textHeight, padX, padY } = useMemo(() => {
    const lines = noteContentToLines(note.text || '(Empty note)', note.fontSize)
    const { padX, padY } = noteCanvasChromePadding(note.fontSize)

    let maxWidth = 0
    for (const line of lines) {
      let lineWidth = 0
      for (const segment of line.segments) {
        const charWidth = (segment.fontSize || note.fontSize) * 0.6
        lineWidth += segment.text.length * charWidth
      }
      maxWidth = Math.max(maxWidth, lineWidth)
    }

    const totalHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0)

    return {
      parsedLines: lines,
      textWidth: maxWidth + padX * 2,
      textHeight: totalHeight + padY * 2,
      padX,
      padY,
    }
  }, [note.text, note.fontSize])
  
  const handleClick = useCallback((e: NotePointerEvent) => {
    if (!interactive) return
    const appWindow = window as WindowWithEendraTapSuppression
    if (appWindow.__eendraSuppressNextElementTap) {
      appWindow.__eendraSuppressNextElementTap = false
      return
    }
    e.cancelBubble = true
    
    // Ignore right-clicks (button 2) - they should only show context menu, not change selection
    if ('button' in e.evt && e.evt.button === 2) {
      return
    }
    
    if ('shiftKey' in e.evt && e.evt.shiftKey) {
      // Shift + Click: Add to selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'note' && !selection.ids.includes(note.id)) {
        setSelection({ type: 'note', ids: [...selection.ids, note.id] })
      } else if (selection.type !== 'note') {
        setSelection({ type: 'note', ids: [note.id] })
      }
    } else if (
      ('altKey' in e.evt && e.evt.altKey) ||
      ('ctrlKey' in e.evt && e.evt.ctrlKey) ||
      ('metaKey' in e.evt && e.evt.metaKey)
    ) {
      // Alt/Ctrl + Click: Remove from selection
      const { selection } = useUIStore.getState()
      if (selection.type === 'note' && selection.ids.includes(note.id)) {
        const newIds = selection.ids.filter(id => id !== note.id)
        if (newIds.length > 0) {
          setSelection({ type: 'note', ids: newIds })
        } else {
          clearSelection()
        }
      }
    } else {
      // Normal click: Replace selection
      setSelection({ type: 'note', ids: [note.id] })
    }
  }, [clearSelection, setSelection, note.id, interactive])
  
  const handleDragMove = useCallback((e: NoteDragEvent) => {
    if (!interactive) return
    if (onDragMove) {
      const pos = e.target.position()
      onDragMove(note.id, { x: pos.x, y: pos.y })
    }
  }, [onDragMove, note.id, interactive])

  const handleDragEnd = useCallback((e: NoteDragEvent) => {
    if (!interactive) return
    if (onDragEnd) {
      const pos = e.target.position()
      onDragEnd(note.id, { x: pos.x, y: pos.y })
    }
  }, [onDragEnd, note.id, interactive])
  
  // Render parsed text segments
  let yOffset = 0
  const textElements: JSX.Element[] = []
  
  parsedLines.forEach((line, lineIndex) => {
    let xOffset = 0
    
    line.segments.forEach((segment, segmentIndex) => {
      const fontStyle = []
      if (segment.bold) fontStyle.push('bold')
      if (segment.italic) fontStyle.push('italic')
      
      textElements.push(
        <Text
          key={`${lineIndex}-${segmentIndex}`}
          x={xOffset}
          y={yOffset}
          text={segment.text}
          fontSize={segment.fontSize || note.fontSize}
          fontFamily={fontFamily}
          fontStyle={fontStyle.join(' ') || 'normal'}
          textDecoration={segment.underline ? 'underline' : ''}
          fill={textColor}
          listening={false}
        />
      )
      
      // Update xOffset for next segment
      const charWidth = (segment.fontSize || note.fontSize) * 0.6
      xOffset += segment.text.length * charWidth
    })
    
    yOffset += line.lineHeight
  })
  
  return (
    <Group 
      name={`note-${note.id}`}
      x={note.pos.x} 
      y={note.pos.y} 
      draggable={interactive}
      onClick={handleClick} 
      onTap={handleClick}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      listening={interactive}
    >
      {/* Invisible hit area for clicking and dragging */}
      <Rect
        x={-padX}
        y={-padY}
        width={textWidth}
        height={textHeight}
        fill="transparent"
        listening={interactive}
      />
      
      {/* Rendered text segments with markdown formatting */}
      {textElements}
      
      {/* Selection highlight */}
      {isSelected && (
        <Rect
          x={-padX}
          y={-padY}
          width={textWidth}
          height={textHeight}
          stroke="#FFC107"
          strokeWidth={2}
          listening={false}
        />
      )}
    </Group>
  )
}
