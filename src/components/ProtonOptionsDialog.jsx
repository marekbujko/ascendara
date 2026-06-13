import { useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const CACHYOS_OPTIONS = [
  { var: "PROTON_ENABLE_WAYLAND", value: "1", labelKey: "wayland" },
  { var: "PROTON_DXVK_SAREK", value: "1", labelKey: "dxvkSarek" },
  { var: "PROTON_DXVK_LOWLATENCY", value: "1", labelKey: "dxvkLowLatency" },
  { var: "PROTON_FSR4_UPGRADE", value: "1", labelKey: "fsr4" },
  { var: "PROTON_FSR4_RDNA3_UPGRADE", value: "1", labelKey: "fsr4Rdna3" },
  { var: "PROTON_DLSS_UPGRADE", value: "1", labelKey: "dlssUpgrade" },
  { var: "PROTON_NVIDIA_LIBS", value: "1", labelKey: "nvidiaLibs" },
  { var: "PROTON_NO_WM_DECORATION", value: "1", labelKey: "noWmDecoration" },
  { var: "PROTON_LOCAL_SHADER_CACHE", value: "1", labelKey: "shaderCache" },
  { var: "PROTON_DISCORD_BRIDGE", value: "1", labelKey: "discordBridge" },
  { var: "PROTON_USE_SDL", value: "1", labelKey: "sdlInput" },
  { var: "PROTON_LOG", value: "1", labelKey: "debugLog" },
];

const GE_OPTIONS = [
  { var: "PROTON_ENABLE_WAYLAND", value: "1", labelKey: "wayland" },
  { var: "PROTON_USE_WOW64", value: "1", labelKey: "wow64" },
  { var: "PROTON_NO_ESYNC", value: "1", labelKey: "noEsync" },
  { var: "PROTON_NO_FSYNC", value: "1", labelKey: "noFsync" },
  { var: "PROTON_NO_NTSYNC", value: "1", labelKey: "noNtsync" },
  { var: "PROTON_USE_WINED3D", value: "1", labelKey: "wined3d" },
  { var: "PROTON_FSR4_UPGRADE", value: "1", labelKey: "fsr4" },
  { var: "PROTON_DLSS_UPGRADE", value: "1", labelKey: "dlssUpgrade" },
  { var: "PROTON_HIDE_NVIDIA_GPU", value: "1", labelKey: "hideNvidia" },
  { var: "PROTON_USE_SECCOMP", value: "1", labelKey: "seccomp" },
  { var: "WINE_FULLSCREEN_FSR", value: "1", labelKey: "fsrUpscale" },
  { var: "PROTON_LOG", value: "1", labelKey: "debugLog" },
];

/**
 * runnerType: "cachyos" | "ge" | null
 */
export default function ProtonOptionsDialog({ open, onOpenChange, runnerType }) {
  const { t } = useTranslation();
  const [copiedVar, setCopiedVar] = useState(null);

  const options = runnerType === "cachyos" ? CACHYOS_OPTIONS : GE_OPTIONS;
  const title =
    runnerType === "cachyos"
      ? t("settings.linuxCompat.protonOptions.titleCachy")
      : t("settings.linuxCompat.protonOptions.titleGE");

  const handleCopy = (varName, value) => {
    const str = `${varName}=${value}`;
    navigator.clipboard.writeText(str);
    setCopiedVar(varName);
    toast.success(
      t("settings.linuxCompat.protonOptions.copied")
    );
    setTimeout(() => setCopiedVar(null), 1500);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg bg-background text-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings.linuxCompat.protonOptions.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="flex flex-col gap-2">
            {options.map(opt => (
              <div
                key={opt.var}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3"
              >
                <div className="flex flex-col">
                  <code className="text-sm font-medium text-primary">
                    {opt.var}={opt.value}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {t(`settings.linuxCompat.protonOptions.${opt.labelKey}`)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-secondary"
                  onClick={() => handleCopy(opt.var, opt.value)}
                >
                  {copiedVar === opt.var ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>

        <AlertDialogFooter>
          <Button variant="outline" className="text-primary" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}