import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductThumb({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted/40 grid place-items-center",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? "Product"}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <Package className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
  );
}
