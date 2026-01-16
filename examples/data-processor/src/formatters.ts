export interface FormatNumberOptions {
  decimals?: number;
  thousandsSeparator?: string;
  decimalSeparator?: string;
}

export function formatNumber(
  num: number,
  options: FormatNumberOptions = {}
): string {
  const { decimals = 2, thousandsSeparator = ",", decimalSeparator = "." } = options;

  const fixed = num.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");

  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator);

  return decPart ? `${formattedInt}${decimalSeparator}${decPart}` : formattedInt;
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours % 24 > 0) parts.push(`${hours % 24}h`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
  if (seconds % 60 > 0 || parts.length === 0) parts.push(`${seconds % 60}s`);

  return parts.join(" ");
}

export function formatDate(date: Date | string, format: string = "YYYY-MM-DD"): string {
  const d = typeof date === "string" ? new Date(date) : date;

  const pad = (n: number) => n.toString().padStart(2, "0");

  const replacements: Record<string, string> = {
    YYYY: d.getFullYear().toString(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (match) => replacements[match]);
}
