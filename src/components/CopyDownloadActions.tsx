import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { copyToClipboard, downloadTextFile } from '../utils/exportEpisode';

interface CopyButtonProps {
  text: string;
  label?: string;
  compact?: boolean;
}

export function CopyButton({ text, label = 'Copy', compact = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 whitespace-nowrap shrink-0 ${
        compact ? 'px-2.5 py-1.5 text-xs min-h-[34px]' : 'px-3.5 py-2 text-xs min-h-[40px]'
      }`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-300">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5 text-slate-400" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

interface DownloadButtonProps {
  filename: string;
  content: string;
  label?: string;
  mimeType?: string;
  compact?: boolean;
}

export function DownloadButton({
  filename,
  content,
  label = 'Download .txt',
  mimeType = 'text/plain;charset=utf-8',
  compact = false,
}: DownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={() => downloadTextFile(filename, content, mimeType)}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 whitespace-nowrap shrink-0 ${
        compact ? 'px-2.5 py-1.5 text-xs min-h-[34px]' : 'px-3.5 py-2 text-xs min-h-[40px]'
      }`}
    >
      <Download className="h-3.5 w-3.5 text-slate-400" />
      <span>{label}</span>
    </button>
  );
}
