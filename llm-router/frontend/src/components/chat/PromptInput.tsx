import { useEffect, useRef } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
}

export const PromptInput = ({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled = false,
}: PromptInputProps) => {
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [value]);

  return (
    <form
      className="modern-composer-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!streaming) onSubmit();
      }}
    >
      <div className="modern-input-wrapper">
        <textarea
          ref={textarea}
          value={value}
          maxLength={32768}
          aria-label="Ask anything"
          placeholder="Message LLM Router or select a template above..."
          rows={1}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && streaming) {
              event.preventDefault();
              onStop();
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!streaming) onSubmit();
            }
          }}
        />

        <div className="modern-composer-controls">
          {streaming ? (
            <button
              className="modern-send-btn stop"
              type="button"
              onClick={onStop}
              aria-label="Stop generation"
              title="Stop generation (Esc)"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="modern-send-btn"
              type="submit"
              disabled={disabled || value.trim().length === 0}
              aria-label="Send message"
              title="Send prompt"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
};
