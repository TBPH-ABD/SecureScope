import clsx from "clsx";
import { Check } from "lucide-react";

export const passwordRules = [
  { label: "12+ characters", test: (p: string) => p.length >= 12 },
  { label: "Upper & lower case", test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: "A number", test: (p: string) => /\d/.test(p) },
];

export function PasswordHint({ value }: { value: string }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
      {passwordRules.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.label} className={clsx("flex items-center gap-1 text-[11px]", ok ? "text-ok" : "text-faint")}>
            <Check className={clsx("h-3 w-3", !ok && "opacity-30")} /> {r.label}
          </li>
        );
      })}
    </ul>
  );
}
