import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Settings, Upload, Calendar, Loader2, FileSpreadsheet, Trash2, AlertCircle } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";

export default function Configuracion() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-lg font-medium mb-2">Acceso Restringido</h2>
          <p className="text-muted-foreground">Solo los administradores pueden acceder a esta sección.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#42302E]">Configuración</h1>
        <p className="text-muted-foreground mt-1">Administración del sistema y calendario DIAN</p>
      </div>

      <Tabs defaultValue="dian">
        <TabsList>
          <TabsTrigger value="dian" className="gap-2">
            <Calendar className="h-4 w-4" /> Calendario DIAN
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-2">
            <Settings className="h-4 w-4" /> General
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dian" className="mt-4">
          <DianCalendarSection />
        </TabsContent>

        <TabsContent value="general" className="mt-4">
          <GeneralSettingsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DianCalendarSection() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [filterObligation, setFilterObligation] = useState("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [parsedEntries, setParsedEntries] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const { data: entries, isLoading, refetch } = trpc.dianCalendar.getEntries.useQuery({
    year: parseInt(selectedYear),
    obligationCode: filterObligation !== "all" ? filterObligation : undefined,
  });

  const { data: obligations } = trpc.obligations.list.useQuery();
  const uploadCalendar = trpc.dianCalendar.upload.useMutation();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "txt"].includes(ext || "")) {
      toast.error("Solo se aceptan archivos CSV o TXT con formato de calendario DIAN");
      return;
    }

    setIsUploading(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      
      // Expected CSV format: obligationCode,period,lastDigitNit,dueDate
      // Skip header if present
      const startIdx = lines[0].toLowerCase().includes("obligat") || lines[0].toLowerCase().includes("codigo") ? 1 : 0;
      
      const parsed: any[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const parts = lines[i].split(/[,;\t]/).map(p => p.trim().replace(/"/g, ""));
        if (parts.length >= 4) {
          parsed.push({
            obligationCode: parts[0],
            period: parts[1],
            lastDigitNit: parts[2],
            dueDate: parts[3],
          });
        }
      }

      if (parsed.length === 0) {
        toast.error("No se encontraron registros válidos en el archivo. Formato esperado: código_obligación, periodo, último_dígito_NIT, fecha_vencimiento");
        return;
      }

      setParsedEntries(parsed);
      setShowPreview(true);
      toast.success(`${parsed.length} registros encontrados. Revise la vista previa.`);
    } catch (error) {
      toast.error("Error al leer el archivo");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmUpload = async () => {
    try {
      const result = await uploadCalendar.mutateAsync({
        year: parseInt(selectedYear),
        entries: parsedEntries,
        clearExisting: true,
      });
      toast.success(`Calendario DIAN actualizado: ${result.count} registros cargados`);
      setParsedEntries([]);
      setShowPreview(false);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al cargar el calendario");
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      <Card className="border-[#EDA011]/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Cargar Calendario DIAN
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Año del calendario</Label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Archivo CSV del calendario</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="gap-2 flex-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    Seleccionar archivo
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.txt"
                    onChange={handleFileSelect}
                  />
                </div>
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="font-medium mb-1">Formato esperado del archivo CSV:</p>
              <code className="text-xs bg-background px-2 py-1 rounded block">
                codigo_obligacion, periodo, ultimo_digito_nit, fecha_vencimiento (YYYY-MM-DD)
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                Ejemplo: IVA_BIM, 2025-01-02, 1, 2025-03-10
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Separadores aceptados: coma, punto y coma, o tabulación.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview of parsed entries */}
      {showPreview && parsedEntries.length > 0 && (
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-green-800">
                Vista Previa ({parsedEntries.length} registros)
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowPreview(false); setParsedEntries([]); }}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Descartar
                </Button>
                <Button size="sm" onClick={handleConfirmUpload} disabled={uploadCalendar.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
                  {uploadCalendar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  Confirmar Carga
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Obligación</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Último Dígito NIT</TableHead>
                    <TableHead>Fecha Vencimiento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedEntries.slice(0, 20).map((entry, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">{entry.obligationCode}</TableCell>
                      <TableCell>{entry.period}</TableCell>
                      <TableCell>{entry.lastDigitNit}</TableCell>
                      <TableCell>{entry.dueDate}</TableCell>
                    </TableRow>
                  ))}
                  {parsedEntries.length > 20 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                        ... y {parsedEntries.length - 20} registros más
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Calendar Entries */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Calendario Cargado - {selectedYear}
            </CardTitle>
            <Select value={filterObligation} onValueChange={setFilterObligation}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrar por obligación" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las obligaciones</SelectItem>
                {obligations?.map((ob: any) => (
                  <SelectItem key={ob.id} value={ob.code}>{ob.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#EDA011]" />
            </div>
          ) : entries && entries.length > 0 ? (
            <div className="max-h-[400px] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Obligación</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Último Dígito NIT</TableHead>
                    <TableHead>Fecha Vencimiento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry: any) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{entry.obligationCode}</Badge>
                      </TableCell>
                      <TableCell>{entry.period}</TableCell>
                      <TableCell className="text-center">{entry.lastDigitNit}</TableCell>
                      <TableCell>{new Date(entry.dueDate).toLocaleDateString("es-CO")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No hay registros del calendario DIAN para {selectedYear}</p>
              <p className="text-sm mt-1">Cargue un archivo CSV con las fechas de vencimiento oficiales.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GeneralSettingsSection() {
  const { data: settings, isLoading, refetch } = trpc.settings.getAll.useQuery();
  const setSetting = trpc.settings.set.useMutation();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleSave = async (key: string) => {
    try {
      await setSetting.mutateAsync({ key, value: editValue });
      toast.success("Configuración actualizada");
      setEditingKey(null);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar");
    }
  };

  const settingsConfig = [
    { key: "drive_folder_url", label: "URL Carpeta Google Drive", description: "Enlace a la carpeta compartida de documentos" },
    { key: "firm_name", label: "Nombre de la Firma", description: "Nombre que aparece en reportes y notificaciones" },
    { key: "notification_days_before", label: "Días de anticipación para alertas", description: "Cuántos días antes de un vencimiento se genera la alerta" },
    { key: "auto_task_days_before", label: "Días de anticipación para tareas automáticas", description: "Cuántos días antes del vencimiento se crea la tarea automática (por defecto: 10)" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-[#EDA011]" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configuración General</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {settingsConfig.map(config => {
            const current = settings?.find((s: any) => s.key === config.key);
            const isEditing = editingKey === config.key;

            return (
              <div key={config.key} className="flex items-center gap-4 p-3 rounded-lg border">
                <div className="flex-1">
                  <p className="font-medium text-sm">{config.label}</p>
                  <p className="text-xs text-muted-foreground">{config.description}</p>
                  {!isEditing && (
                    <p className="text-sm mt-1 font-mono text-[#42302E]">
                      {current?.value || <span className="text-muted-foreground italic">No configurado</span>}
                    </p>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex gap-2 items-center">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-[300px]"
                      autoFocus
                    />
                    <Button size="sm" onClick={() => handleSave(config.key)} disabled={setSetting.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
                      Guardar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingKey(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditingKey(config.key); setEditValue(current?.value || ""); }}
                  >
                    Editar
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
