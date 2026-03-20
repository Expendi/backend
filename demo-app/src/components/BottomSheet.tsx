import { Drawer } from "vaul";
import "../styles/bottom-sheet.css";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  snapPoints?: (number | string)[];
}

export function BottomSheet({ open, onClose, title, children, snapPoints }: BottomSheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      snapPoints={snapPoints}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="bottom-sheet-overlay" />
        <Drawer.Content className="bottom-sheet-content" aria-describedby={undefined}>
          <div className="bottom-sheet-handle-bar" />
          {title && <Drawer.Title className="bottom-sheet-title">{title}</Drawer.Title>}
          {!title && <Drawer.Title className="bottom-sheet-title" style={{ display: "none" }}>Sheet</Drawer.Title>}
          <div className="bottom-sheet-body">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
