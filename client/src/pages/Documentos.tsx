import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { FolderOpen, ExternalLink, Loader2, Save, Info } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function Documentos() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: driveSetting, isLoading, refetch } = trpc.settings.get.useQuery({ key: "drive_folder_url" });
  const setSetting = trpc.settings.set.useMutation();
  const [editUrl, setEditUrl] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (driveSetting?.value) {
      setEditUrl(driveSetting.value);
    }
  }, [driveSetting]);

  const handleSave = async () => {
    if (!editUrl.trim()) {
      toast.error("Ingrese una URL válida de Google Drive");
      return;
    }
    try {
      await setSetting.mutateAsync({
        key: "drive_folder_url",
        value: editUrl.trim(),
        description: "URL de la carpeta compartida de Google Drive para documentos",
      });
      toast.success("URL de Drive actualizada");
      setIsEditing(false);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar la configuración");
    }
  };

  const driveUrl = driveSetting?.value;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#EDA011]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E]">Documentos</h1>
          <p className="text-muted-foreground mt-1">
            Acceso a la carpeta compartida de documentos en Google Drive
          </p>
        </div>
      </div>

      {/* Admin: Configure Drive URL */}
      {isAdmin && (
        <Card className="border-[#EDA011]/30 bg-[#F6DAAB]/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Configuración de Drive (Solo Admin)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>URL de la carpeta de Google Drive</Label>
                <div className="flex gap-2">
                  <Input
                    value={editUrl}
                    onChange={(e) => { setEditUrl(e.target.value); setIsEditing(true); }}
                    placeholder="https://drive.google.com/drive/folders/..."
                    className="flex-1"
                  />
                  {isEditing && (
                    <Button onClick={handleSave} disabled={setSetting.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white gap-2">
                      {setSetting.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Guardar
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Pegue aquí la URL de la carpeta compartida de Google Drive donde se almacenan los documentos del equipo.
                Asegúrese de que la carpeta tenga los permisos adecuados para los colaboradores.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content: Drive Link */}
      {driveUrl ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="bg-gradient-to-r from-[#42302E] to-[#5a4440] p-8 text-white text-center">
              <FolderOpen className="h-16 w-16 mx-auto mb-4 opacity-90" />
              <h2 className="text-xl font-semibold mb-2">Carpeta de Documentos</h2>
              <p className="text-white/80 mb-6 max-w-md mx-auto">
                Acceda a la carpeta compartida de Google Drive para descargar y cargar documentos del equipo.
              </p>
              <Button
                asChild
                size="lg"
                className="bg-[#EDA011] hover:bg-[#d48f0f] text-white gap-2 text-base px-8"
              >
                <a href={driveUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-5 w-5" />
                  Abrir en Google Drive
                </a>
              </Button>
            </div>
            <div className="p-6 bg-[#F6DAAB]/10">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-[#A9AD94] mt-0.5 shrink-0" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Instrucciones:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Puede descargar documentos directamente desde Google Drive</li>
                    <li>Para cargar archivos, arrástrelos a la carpeta correspondiente</li>
                    <li>Mantenga una estructura organizada por cliente y tipo de documento</li>
                    <li>Los archivos sensibles deben estar en subcarpetas con acceso restringido</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <FolderOpen className="h-16 w-16 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-lg font-medium mb-2">Carpeta no configurada</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              {isAdmin
                ? "Configure la URL de la carpeta de Google Drive en el panel de arriba para que los colaboradores puedan acceder a los documentos."
                : "El administrador aún no ha configurado la carpeta de documentos. Contacte al administrador para habilitarla."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Settings({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
