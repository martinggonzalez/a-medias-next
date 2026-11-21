export type IconName = "camera" | "upload" | "receipt" | "check" | "plus" | "trash" | "arrow" | "history" | "close" | "lock" | "refresh" | "download" | "users" | "logout"|"alert";

const paths: Record<IconName, string[]> = {
  camera: ["M14 4h-4L8 7H4a2 2 0 0 0-2 2v10h20V9a2 2 0 0 0-2-2h-4z", "M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0"],
  upload: ["M12 16V3m-5 5 5-5 5 5", "M4 15v6h16v-6"],
  receipt: ["M6 3h12v19l-3-2-3 2-3-2-3 2V3Z", "M9 7h6M9 11h6M9 15h3"],
  check: ["m5 12 4 4L19 6"],
  plus: ["M12 5v14M5 12h14"],
  trash: ["M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"],
  arrow: ["M4 12h16m-6-6 6 6-6 6"],
  history: ["M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"],
  close: ["m6 6 12 12M6 18 18 6"],
  lock: ["M5 10h14v12H5z", "M8 10V6a4 4 0 0 1 8 0v4M12 15v3"],
  refresh: ["M20 7v5h-5M4 17v-5h5", "M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"],
  download: ["M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"],
  users: ["M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M5 21v-3a7 7 0 0 1 14 0v3M17 3a4 4 0 0 1 0 8M22 21v-4a5 5 0 0 0-3-5"],
  logout: ["M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"],
  alert: ["M12 9v4M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"]
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name].map((path, index) => <path key={index} d={path} />)}</svg>;
}
