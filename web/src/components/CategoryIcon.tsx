import {
  ArmchairIcon,
  BooksIcon,
  CameraIcon,
  CoinsIcon,
  CubeIcon,
  HandbagIcon,
  HandHeartIcon,
  MotorcycleIcon,
  PaletteIcon,
  SoccerBallIcon,
  SparkleIcon,
  SquaresFourIcon,
  TrophyIcon,
  WatchIcon,
  type Icon,
} from "@phosphor-icons/react";

const icons: Record<string, Icon> = {
  all: SquaresFourIcon,
  league: TrophyIcon,
  art: PaletteIcon,
  collectibles: CubeIcon,
  coins: CoinsIcon,
  electronics: CameraIcon,
  fashion: HandbagIcon,
  jewellery: WatchIcon,
  vehicles: MotorcycleIcon,
  home: ArmchairIcon,
  sports: SoccerBallIcon,
  books: BooksIcon,
  charity: HandHeartIcon,
  other: SparkleIcon,
};

/** Category glyph from Phosphor (the app's single icon family). */
export function CategoryIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const Glyph = icons[name];
  if (!Glyph) return null;
  return <Glyph className={`shrink-0 ${className}`} weight="bold" aria-hidden="true" />;
}
