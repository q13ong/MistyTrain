import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
} from "lucide-react";
import type { Direction } from "@fog-train/shared";

const controls: Array<{
  direction: Direction;
  label: string;
  Icon: typeof ArrowUp;
  area: string;
}> = [
  { direction: "up_left", label: "左上", Icon: ArrowUpLeft, area: "up-left" },
  { direction: "up", label: "上", Icon: ArrowUp, area: "up" },
  { direction: "up_right", label: "右上", Icon: ArrowUpRight, area: "up-right" },
  { direction: "left", label: "左", Icon: ArrowLeft, area: "left" },
  { direction: "right", label: "右", Icon: ArrowRight, area: "right" },
  { direction: "down_left", label: "左下", Icon: ArrowDownLeft, area: "down-left" },
  { direction: "down", label: "下", Icon: ArrowDown, area: "down" },
  { direction: "down_right", label: "右下", Icon: ArrowDownRight, area: "down-right" },
];

export function ControlPad({
  disabled,
  legalMoves,
  onMove,
}: {
  disabled: boolean;
  legalMoves: Direction[];
  onMove: (direction: Direction) => void;
}) {
  return (
    <div className="control-pad">
      <span className="control-center">移动</span>
      {controls.map(({ direction, label, Icon, area }) => (
        <button
          aria-label={label}
          className={`control-${area}`}
          disabled={disabled || !legalMoves.includes(direction)}
          key={direction}
          onClick={() => onMove(direction)}
          title={label}
          type="button"
        >
          <Icon size={20} />
        </button>
      ))}
    </div>
  );
}
