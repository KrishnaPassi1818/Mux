import { stringify } from 'yaml';
import type { BenchmarkResult } from '../api/client';
import { formatDuration, formatPercent } from './format';

export const exportAsJson = (result: BenchmarkResult): void => {
  const jsonStr = JSON.stringify(result, null, 2);
  downloadBlob(new Blob([jsonStr], { type: 'application/json' }), `llm-router-benchmark-${result.id}.json`);
};

export const exportAsYaml = (result: BenchmarkResult): void => {
  const yamlStr = stringify(result);
  downloadBlob(new Blob([yamlStr], { type: 'text/yaml' }), `llm-router-benchmark-${result.id}.yaml`);
};

export const exportAsPdf = (result: BenchmarkResult): void => {
  const pdfBytes = generateBenchmarkPdf(result);
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  downloadBlob(blob, `llm-router-benchmark-${result.id}.pdf`);
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
}

const generateBenchmarkPdf = (result: BenchmarkResult): Uint8Array => {
  const pages: string[] = [];
  let currentLines: PdfLine[] = [];

  const addLine = (text: string, bold = false, size = 10) => {
    if (currentLines.length >= 44) {
      pages.push(renderPageStream(currentLines));
      currentLines = [];
    }
    currentLines.push({ text, bold, size });
  };

  const renderPageStream = (lines: PdfLine[]): string => {
    let stream = 'BT\n';
    let y = 800;
    for (const item of lines) {
      const font = item.bold ? '/F2' : '/F1';
      const size = item.size ?? 10;
      const escaped = item.text.replace(/[\\()]/g, (c) => `\\${c}`);
      stream += `${font} ${size} Tf\n40 ${y} Td\n(${escaped}) Tj\nET\nBT\n`;
      y -= size + 4;
    }
    stream += 'ET\n';
    return stream;
  };

  addLine('LLM Router - Benchmark Evaluation Report', true, 16);
  addLine(`Generated: ${new Date().toISOString()}  |  Run ID: ${result.id}`, false, 9);
  addLine('---------------------------------------------------------------------------------------------------', false, 9);
  addLine('', false, 5);

  addLine('1. EXECUTIVE SUMMARY & VERDICT', true, 12);
  addLine(`Verdict: ${result.verdict || 'No verdict generated.'}`, false, 10);
  addLine(`Hardware: ${result.hardware || 'Not detected'}`, false, 9);
  addLine(`Total Prompts: ${result.prompt_count} labeled test prompts`, false, 9);
  addLine(`Date Executed: ${new Date(result.created_at).toLocaleString()}`, false, 9);
  addLine('', false, 6);

  addLine('2. KEY PERFORMANCE INDICATORS (KPIS)', true, 12);
  const kpis = result.kpis ?? {};
  addLine(`• KPI-1 Routing Accuracy: ${typeof kpis.KPI1_routing_accuracy === 'number' ? formatPercent(kpis.KPI1_routing_accuracy, true) : 'N/A'} (Target: ${typeof kpis.KPI1_target === 'number' ? formatPercent(kpis.KPI1_target, true) : '85%'} | Pass: ${kpis.KPI1_pass ? 'YES' : 'NO'})`, false, 9);
  addLine(`• KPI-2 Latency Reduction: ${typeof kpis.KPI2_router_mean_latency_reduction_pct === 'number' ? `${kpis.KPI2_router_mean_latency_reduction_pct.toFixed(1)}%` : 'N/A'} (Target: ${typeof kpis.KPI2_target === 'number' ? `${kpis.KPI2_target}%` : '30%'} | Pass: ${kpis.KPI2_pass ? 'YES' : 'NO'})`, false, 9);
  addLine(`• KPI-3 Cache Hit Rate (Run C): ${typeof kpis.KPI3_cache_hit_rate_C === 'number' ? formatPercent(kpis.KPI3_cache_hit_rate_C, true) : 'N/A'}`, false, 9);
  addLine('', false, 6);

  addLine('3. DETAILED RUN METRICS SUMMARY', true, 12);
  addLine(pad('Metric', 24) + pad('Run A (Heavy Only)', 20) + pad('Run B (Router)', 20) + pad('Run C (Router+Cache)', 20), true, 9);
  addLine('---------------------------------------------------------------------------------------------------', false, 9);

  const runs = result.runs || {};
  type MetricField = 'mean_ms' | 'p50_ms' | 'p95_ms' | 'ttft_mean_ms' | 'tokens_per_sec' | 'swaps' | 'cache_hit_rate' | 'accuracy' | 'total_wall_ms';
  const metrics: { label: string; field: MetricField; fmt: (v?: number) => string }[] = [
    { label: 'Mean Latency', field: 'mean_ms', fmt: (v) => formatDuration(v) },
    { label: 'p50 Latency', field: 'p50_ms', fmt: (v) => formatDuration(v) },
    { label: 'p95 Latency', field: 'p95_ms', fmt: (v) => formatDuration(v) },
    { label: 'TTFT Mean', field: 'ttft_mean_ms', fmt: (v) => formatDuration(v) },
    { label: 'Tokens / Sec', field: 'tokens_per_sec', fmt: (v) => v !== undefined && Number.isFinite(v) ? `${v.toFixed(1)} tok/s` : '-' },
    { label: 'Model Swaps', field: 'swaps', fmt: (v) => v !== undefined ? String(Math.round(v)) : '-' },
    { label: 'Cache Hit Rate', field: 'cache_hit_rate', fmt: (v) => formatPercent(v, true) },
    { label: 'Routing Accuracy', field: 'accuracy', fmt: (v) => formatPercent(v, true) },
    { label: 'Total Wall Time', field: 'total_wall_ms', fmt: (v) => formatDuration(v) },
  ];

  for (const m of metrics) {
    const aVal = m.fmt(runs.A?.[m.field]);
    const bVal = m.fmt(runs.B?.[m.field]);
    const cVal = m.fmt(runs.C?.[m.field]);
    addLine(pad(m.label, 24) + pad(aVal, 20) + pad(bVal, 20) + pad(cVal, 20), false, 9);
  }
  addLine('', false, 6);

  if (result.confusion_matrix) {
    addLine('4. ROUTING CONFUSION MATRIX (Run B)', true, 12);
    addLine(pad('Expected \\ Routed', 24) + pad('light', 16) + pad('code', 16) + pad('heavy', 16), true, 9);
    for (const expTier of ['light', 'code', 'heavy'] as const) {
      const row = result.confusion_matrix[expTier] || {};
      addLine(pad(expTier, 24) + pad(String(row.light ?? 0), 16) + pad(String(row.code ?? 0), 16) + pad(String(row.heavy ?? 0), 16), false, 9);
    }
    addLine('', false, 6);
  }

  if (result.methodology) {
    addLine('5. METHODOLOGY & PROVENANCE', true, 12);
    // Split methodology into chunks of ~90 characters
    const words = result.methodology.split(' ');
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + ' ' + word).length > 88) {
        addLine(currentLine.trim(), false, 8);
        currentLine = word + ' ';
      } else {
        currentLine += word + ' ';
      }
    }
    if (currentLine.trim()) addLine(currentLine.trim(), false, 8);
  }

  if (currentLines.length > 0) {
    pages.push(renderPageStream(currentLines));
  }

  return assemblePdfDocument(pages);
};

const pad = (str: string, width: number): string => {
  if (str.length >= width) return str.slice(0, width - 1) + ' ';
  return str + ' '.repeat(width - str.length);
};

const assemblePdfDocument = (pages: string[]): Uint8Array => {
  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const fontRegularIndex = 3;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldIndex = 4;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  for (let i = 0; i < pages.length; i++) {
    const pageIndex = 5 + i * 2;
    const contentIndex = pageIndex + 1;
    const streamContent = pages[i] ?? '';
    const streamLen = new TextEncoder().encode(streamContent).length;
    addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${contentIndex} 0 R /Resources << /Font << /F1 ${fontRegularIndex} 0 R /F2 ${fontBoldIndex} 0 R >> >> >>`);
    addObject(`<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < objects.length; i++) {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += offset.toString().padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF\n';

  return encoder.encode(pdf);
};
