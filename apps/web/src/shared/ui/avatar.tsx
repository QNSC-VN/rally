import { BRAND } from '@/shared/config/brand'

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

interface AvatarProps {
  name: string
  size?: number
}

export function Avatar({ name, size = 28 }: AvatarProps) {
  return (
    <div
      aria-label={name}
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white select-none"
      style={{ width: size, height: size, backgroundColor: BRAND.primaryLight }}
    >
      {initials(name)}
    </div>
  )
}
