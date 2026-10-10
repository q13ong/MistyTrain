import {
  Briefcase,
  Bug,
  Cigarette,
  CircleHelp,
  Clapperboard,
  CloudFog,
  Compass,
  CookingPot,
  Cross,
  Crosshair,
  EyeOff,
  Footprints,
  Ghost,
  PaintBucket,
  Search,
  Skull,
  Sparkles,
  Swords,
  TrainFront,
  UserRound,
  type LucideIcon,
} from "lucide-react";

const ROLE_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  circle_help: CircleHelp,
  crosshair: Crosshair,
  train: TrainFront,
  paint_bucket: PaintBucket,
  footprints: Footprints,
  compass: Compass,
  eye_off: EyeOff,
  sparkles: Sparkles,
  search: Search,
  swords: Swords,
  cigarette: Cigarette,
  cross: Cross,
  bug: Bug,
  skull: Skull,
  user_round: UserRound,
  clapperboard: Clapperboard,
  cooking_pot: CookingPot,
  ghost: Ghost,
  cloud_fog: CloudFog,
};

export function RoleIcon({
  className,
  icon,
  size = 24,
  symbol,
}: {
  className?: string;
  icon?: string | null;
  size?: number;
  symbol?: string | null;
}) {
  const Icon = icon ? ROLE_ICONS[icon] : undefined;
  return (
    <span className={className}>
      {Icon ? <Icon aria-hidden="true" size={size} /> : (symbol || "?")}
    </span>
  );
}
