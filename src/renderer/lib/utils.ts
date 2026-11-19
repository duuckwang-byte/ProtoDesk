import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** shadcn `cn()`：仅 clsx + tailwind-merge，绝不引入名叫 `cn` 的包（§6.1）。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
