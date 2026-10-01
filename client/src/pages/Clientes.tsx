import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Building2, Plus, Upload, Loader2, Search, FileText, Sparkles, UserCheck, AlertCircle, FolderOpen, Receipt, Download, Trash2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

export default function Clientes() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  const utils = trpc.useUtils();
  const { data: clients, isLoading, refetch } = trpc.clients.list.useQuery({ incluirInactivos: mostrarInactivos });
  const { data: obligations } = trpc.obligations.list.useQuery();
  const { data: collaborators } = trpc.collaborators.getActive.useQuery();
  const createClient = trpc.clients.create.useMutation();
  const updateClient = trpc.clients.update.useMutation();
  const uploadRut = trpc.clients.uploadRut.useMutation();
  const extractRut = trpc.clients.extractRutData.useMutation();
  const setObligations = trpc.obligations.setClientObligations.useMutation();
  const deactivateClient = trpc.clients.deactivate.useMutation({
    onSuccess: () => { toast.success("Cliente inactivado"); utils.clients.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo inactivar"),
  });
  const reactivateClient = trpc.clients.reactivate.useMutation({
    onSuccess: () => { toast.success("Cliente reactivado"); utils.clients.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo reactivar"),
  });

  const handleToggleActivo = (client: any) => {
    const accion = client.isActive ? "inactivar" : "reactivar";
    if (!window.confirm(`¿Seguro que quieres ${accion} a ${client.razonSocial}? Esto no afecta sus datos ya cargados en ningún módulo.`)) return;
    if (client.isActive) deactivateClient.mutate({ id: client.id });
    else reactivateClient.mutate({ id: client.id });
  };

  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [selectedObligationIds, setSelectedObligationIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    razonSocial: "",
    nit: "",
    digitoVerificacion: "",
    direccion: "",
    ciudad: "",
    departamento: "",
    telefono: "",
    email: "",
    actividadEconomica: "",
    codigoCIIU: "",
    representanteLegal: "",
    rutFileUrl: "",
    rutFileKey: "",
    managerId: "",
    driveFolderUrl: "",
    notes: "",
  });

  const resetForm = () => {
    setForm({
      razonSocial: "", nit: "", digitoVerificacion: "", direccion: "",
      ciudad: "", departamento: "", telefono: "", email: "",
      actividadEconomica: "", codigoCIIU: "", representanteLegal: "",
      rutFileUrl: "", rutFileKey: "", managerId: "", driveFolderUrl: "", notes: "",
    });
    setEditingClient(null);
    setSelectedObligationIds([]);
  };

  const handleOpenNew = () => { resetForm(); setShowForm(true); };

  // Load client obligations when editing
  const { data: clientObligationsData } = trpc.obligations.getClientObligations.useQuery(
    { clientId: editingClient?.id },
    { enabled: !!editingClient }
  );

  useEffect(() => {
    if (clientObligationsData) {
      setSelectedObligationIds(clientObligationsData.map((o: any) => o.obligationId));
    }
  }, [clientObligationsData]);

  const handleEdit = (client: any) => {
    setEditingClient(client);
    setForm({
      razonSocial: client.razonSocial || "",
      nit: client.nit || "",
      digitoVerificacion: client.digitoVerificacion || "",
      direccion: client.direccion || "",
      ciudad: client.ciudad || "",
      departamento: client.departamento || "",
      telefono: client.telefono || "",
      email: client.email || "",
      actividadEconomica: client.actividadEconomica || "",
      codigoCIIU: client.codigoCIIU || "",
      representanteLegal: client.representanteLegal || "",
      rutFileUrl: client.rutFileUrl || "",
      rutFileKey: client.rutFileKey || "",
      managerId: client.managerId ? String(client.managerId) : "",
      driveFolderUrl: client.driveFolderUrl || "",
      notes: client.notes || "",
    });
    setShowForm(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Formato no soportado. Use PDF, PNG, JPG o WEBP.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar los 10MB.");
      return;
    }

    try {
      setIsExtracting(true);
      toast.info("Subiendo RUT y extrayendo datos con IA...");

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          
          // Step 1: Upload the file
          const uploadResult = await uploadRut.mutateAsync({
            fileName: file.name,
            fileBase64: base64,
            contentType: file.type,
          });

          setForm((prev) => ({
            ...prev,
            rutFileUrl: uploadResult.url,
            rutFileKey: uploadResult.key,
          }));

          toast.success("RUT subido. Extrayendo datos...");

          // Step 2: Extract data with AI
          try {
            const extractedData = await extractRut.mutateAsync({
              fileUrl: uploadResult.url,
              fileKey: uploadResult.key,
              contentType: file.type,
            });

            if (extractedData.error) {
              toast.warning("La IA no pudo leer todos los campos. Verifique los datos extraídos manualmente.");
            } else {
              setForm((prev) => ({
                ...prev,
                razonSocial: extractedData.razonSocial || prev.razonSocial,
                nit: extractedData.nit || prev.nit,
                digitoVerificacion: extractedData.digitoVerificacion || prev.digitoVerificacion,
                direccion: extractedData.direccion || prev.direccion,
                ciudad: extractedData.ciudad || prev.ciudad,
                departamento: extractedData.departamento || prev.departamento,
                actividadEconomica: extractedData.actividadEconomica || prev.actividadEconomica,
                codigoCIIU: extractedData.codigoCIIU || prev.codigoCIIU,
                representanteLegal: extractedData.representanteLegal || prev.representanteLegal,
                email: extractedData.email || prev.email,
                telefono: extractedData.telefono || prev.telefono,
              }));
              toast.success("Datos extraídos del RUT exitosamente");
            }
          } catch (extractError) {
            console.error("RUT extraction error:", extractError);
            toast.warning("El RUT se subió pero la extracción automática falló. Complete los datos manualmente.");
          }
        } catch (uploadError) {
          console.error("RUT upload error:", uploadError);
          toast.error("Error al subir el archivo del RUT");
        } finally {
          setIsExtracting(false);
        }
      };
      reader.onerror = () => {
        setIsExtracting(false);
        toast.error("Error al leer el archivo");
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setIsExtracting(false);
      toast.error("Error al procesar el archivo");
    }
  };

  const handleSave = async () => {
    if (!form.razonSocial || !form.nit) {
      toast.error("Razón social y NIT son obligatorios");
      return;
    }

    try {
      const payload = {
        razonSocial: form.razonSocial,
        nit: form.nit,
        digitoVerificacion: form.digitoVerificacion || undefined,
        direccion: form.direccion || undefined,
        ciudad: form.ciudad || undefined,
        departamento: form.departamento || undefined,
        telefono: form.telefono || undefined,
        email: form.email || undefined,
        actividadEconomica: form.actividadEconomica || undefined,
        codigoCIIU: form.codigoCIIU || undefined,
        representanteLegal: form.representanteLegal || undefined,
        rutFileUrl: form.rutFileUrl || undefined,
        rutFileKey: form.rutFileKey || undefined,
        managerId: form.managerId ? parseInt(form.managerId) : undefined,
        driveFolderUrl: form.driveFolderUrl || undefined,
        notes: form.notes || undefined,
      };

      if (editingClient) {
        await updateClient.mutateAsync({ id: editingClient.id, ...payload });
        await setObligations.mutateAsync({
          clientId: editingClient.id,
          obligationIds: selectedObligationIds,
        });
        toast.success("Cliente actualizado correctamente");
      } else {
        const result = await createClient.mutateAsync(payload);
        if (selectedObligationIds.length > 0 && result.id) {
          await setObligations.mutateAsync({
            clientId: result.id,
            obligationIds: selectedObligationIds,
          });
        }
        toast.success("Cliente creado correctamente");
      }
      setShowForm(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar el cliente");
    }
  };

  const toggleObligation = (id: number) => {
    setSelectedObligationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filteredClients = clients?.filter(
    (c: any) =>
      c.razonSocial.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.nit.includes(searchTerm)
  );

  // Admin-only guard — placed after all hooks are declared (never skip hook
  // calls conditionally, that breaks React's "same hooks every render" rule
  // and throws "Rendered more hooks than during the previous render").
  if (!isAdmin) {
    return (
      <DashboardLayout>
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-lg font-medium mb-2">Acceso Restringido</h2>
          <p className="text-muted-foreground">Solo los administradores pueden acceder a esta sección.</p>
        </div>
      </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E]">Clientes</h1>
          <p className="text-muted-foreground mt-1">Gestión de clientes de la firma</p>
        </div>
        <Button onClick={handleOpenNew} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
          <Plus className="h-4 w-4" /> Nuevo Cliente
        </Button>
      </div>

      <Tabs defaultValue="clientes">
        <TabsList>
          <TabsTrigger value="clientes" className="gap-1.5"><Building2 className="w-3.5 h-3.5" /> Clientes</TabsTrigger>
          <TabsTrigger value="cuentas_cobro" className="gap-1.5"><Receipt className="w-3.5 h-3.5" /> Cuentas de Cobro</TabsTrigger>
        </TabsList>

        <TabsContent value="clientes" className="mt-4 space-y-4">
      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre o NIT..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer shrink-0">
          <Checkbox checked={mostrarInactivos} onCheckedChange={(v) => setMostrarInactivos(!!v)} />
          Mostrar inactivos
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredClients && filteredClients.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Razón Social</TableHead>
                  <TableHead>NIT</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>RUT</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client: any) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">
                      {client.razonSocial}
                      {!client.isActive && <Badge variant="outline" className="ml-2 text-[10px] bg-gray-100 text-gray-600 border-gray-300">Inactivo</Badge>}
                    </TableCell>
                    <TableCell>{client.nit}{client.digitoVerificacion && `-${client.digitoVerificacion}`}</TableCell>
                    <TableCell className="text-sm">{client.ciudad || "-"}</TableCell>
                    <TableCell className="text-sm">
                      {client.managerName ? (
                        <span className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3 text-[#A9AD94]" />
                          {client.managerName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Sin asignar</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.rutFileUrl ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1">
                          <FileText className="h-3 w-3" /> Cargado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Sin RUT</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(client)}>Editar</Button>
                        <Button
                          variant="outline" size="sm" className={client.isActive ? "text-orange-600 border-orange-300" : "text-green-600 border-green-300"}
                          onClick={() => handleToggleActivo(client)}
                        >
                          {client.isActive ? "Inactivar" : "Reactivar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No hay clientes registrados</p>
              <p className="text-sm mt-1">Haga clic en "Nuevo Cliente" para comenzar</p>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="cuentas_cobro" className="mt-4">
          <CuentasCobroClientesTab />
        </TabsContent>
      </Tabs>

      {/* Client Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {editingClient ? "Editar Cliente" : "Nuevo Cliente"}
            </DialogTitle>
          </DialogHeader>

          {/* RUT Upload */}
          <div className="border-2 border-dashed border-[#EDA011]/40 rounded-lg p-4 bg-[#F6DAAB]/10">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#EDA011]" />
                  Carga del RUT (extracción automática con IA)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Suba el RUT en PDF o imagen y los datos se extraerán automáticamente
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExtracting}
                className="gap-2 border-[#EDA011] text-[#42302E] hover:bg-[#F6DAAB]/30"
              >
                {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isExtracting ? "Procesando..." : "Subir RUT"}
              </Button>
              <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileUpload} />
            </div>
            {form.rutFileUrl && (
              <Badge variant="outline" className="mt-2 bg-green-50 text-green-700 border-green-200">
                <FileText className="h-3 w-3 mr-1" /> RUT cargado exitosamente
              </Badge>
            )}
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Razón Social *</Label>
              <Input value={form.razonSocial} onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} placeholder="Nombre de la empresa" />
            </div>
            <div className="space-y-2">
              <Label>NIT *</Label>
              <Input value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} placeholder="900123456" />
            </div>
            <div className="space-y-2">
              <Label>Dígito de Verificación</Label>
              <Input value={form.digitoVerificacion} onChange={(e) => setForm({ ...form, digitoVerificacion: e.target.value })} placeholder="7" maxLength={1} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Dirección</Label>
              <Input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} placeholder="Calle 100 # 10-20" />
            </div>
            <div className="space-y-2">
              <Label>Ciudad</Label>
              <Input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} placeholder="Bogotá" />
            </div>
            <div className="space-y-2">
              <Label>Departamento</Label>
              <Input value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })} placeholder="Cundinamarca" />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="3001234567" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="empresa@ejemplo.com" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Actividad Económica</Label>
              <Input value={form.actividadEconomica} onChange={(e) => setForm({ ...form, actividadEconomica: e.target.value })} placeholder="Consultoría empresarial" />
            </div>
            <div className="space-y-2">
              <Label>Código CIIU</Label>
              <Input value={form.codigoCIIU} onChange={(e) => setForm({ ...form, codigoCIIU: e.target.value })} placeholder="7020" />
            </div>
            <div className="space-y-2">
              <Label>Representante Legal</Label>
              <Input value={form.representanteLegal} onChange={(e) => setForm({ ...form, representanteLegal: e.target.value })} placeholder="Nombre completo" />
            </div>

            {/* Manager Assignment */}
            <div className="space-y-2 md:col-span-2">
              <Label className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[#A9AD94]" />
                Colaborador Responsable (Manager)
              </Label>
              <Select value={form.managerId} onValueChange={(v) => setForm({ ...form, managerId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Asignar colaborador responsable..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {collaborators?.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name || c.username} — {c.role === "admin" ? "Administrador" : c.role === "contador_senior" ? "Contador Senior" : c.role === "contador_junior" ? "Contador Junior" : "Asistente"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                El manager es responsable de las obligaciones tributarias de este cliente
              </p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-[#A9AD94]" />
                Carpeta de Drive del Cliente
              </Label>
              <Input
                value={form.driveFolderUrl}
                onChange={(e) => setForm({ ...form, driveFolderUrl: e.target.value })}
                placeholder="https://drive.google.com/drive/folders/..."
              />
              <p className="text-xs text-muted-foreground">
                Los colaboradores verán un enlace directo a esta carpeta al subir soportes de las tareas de este cliente
              </p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Notas</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones adicionales..." rows={2} />
            </div>
          </div>

          {/* Tax Obligations Section */}
          <Separator />
          <div className="space-y-3">
            <Label className="text-base font-semibold">Obligaciones Tributarias</Label>
            <p className="text-xs text-muted-foreground">
              Seleccione las obligaciones tributarias que aplican a este cliente
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-2">
              {obligations?.map((obligation: any) => (
                <div key={obligation.id} className="flex items-center gap-2 p-2 rounded-md border hover:bg-muted/50 transition-colors">
                  <Checkbox
                    id={`obl-form-${obligation.id}`}
                    checked={selectedObligationIds.includes(obligation.id)}
                    onCheckedChange={() => toggleObligation(obligation.id)}
                  />
                  <label htmlFor={`obl-form-${obligation.id}`} className="text-sm cursor-pointer flex-1">
                    {obligation.name}
                    <span className="text-xs text-muted-foreground ml-1">({obligation.frequency})</span>
                  </label>
                </div>
              ))}
            </div>
            {selectedObligationIds.length > 0 && (
              <p className="text-xs text-[#EDA011] font-medium">
                {selectedObligationIds.length} obligación(es) seleccionada(s)
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={createClient.isPending || updateClient.isPending || setObligations.isPending}
              className="bg-[#EDA011] hover:bg-[#d48f0f] text-white"
            >
              {(createClient.isPending || updateClient.isPending || setObligations.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingClient ? "Actualizar" : "Crear Cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}

/** Hoy en Bogotá como "AAAA-MM-DD" (valor por defecto del campo Fecha). */
function hoyBogotaIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** La fecha de una cuenta de cobro se guarda como medianoche UTC del día
 * calendario — se formatea en UTC para que no se corra un día en Colombia. */
function formatearFechaCuenta(fecha: string | Date): string {
  return new Date(fecha).toLocaleDateString("es-CO", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

type ConceptoForm = { id: number; detalle: string; valor: string /* solo dígitos */ };

let siguienteIdConcepto = 1;
const conceptoVacio = (): ConceptoForm => ({ id: siguienteIdConcepto++, detalle: "", valor: "" });

/** Pestaña "Cuentas de Cobro" — misma dinámica que la de Renta PN (CTA),
 * pero para cualquier cliente general de la firma. Prefijo propio "AP",
 * consecutivo que sigue el que se llevaba en el sistema anterior. Admite
 * varios conceptos por cuenta (el total es su suma) y fecha editable. */
function CuentasCobroClientesTab() {
  const { user } = useAuth();
  // Igual que en Renta PN: cualquier admin puede generar, pero eliminar
  // queda restringido a Arlex puntualmente.
  const puedeEliminar = user?.cedula === "5820262";

  const utils = trpc.useUtils();
  const clientesQuery = trpc.clients.list.useQuery({ incluirInactivos: false });
  const listaQuery = trpc.clients.cuentasCobro.listar.useQuery();

  const clientesConCta = new Set((listaQuery.data || []).map((cta: any) => cta.clientId));

  const [clientId, setClientId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(hoyBogotaIso);
  const [conceptos, setConceptos] = useState<ConceptoForm[]>(() => [conceptoVacio()]);
  const [idParaEnfocar, setIdParaEnfocar] = useState<number | null>(null);
  const refsDetalle = useRef<Map<number, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (idParaEnfocar == null) return;
    refsDetalle.current.get(idParaEnfocar)?.focus();
    setIdParaEnfocar(null);
  }, [idParaEnfocar]);

  const siguienteNumeroQuery = trpc.clients.cuentasCobro.siguienteNumero.useQuery({ prefijo: "AP" });

  const clienteSeleccionado = (clientesQuery.data || []).find((c: any) => String(c.id) === clientId);

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
  const valorNumerico = (c: ConceptoForm) => (c.valor ? Number(c.valor) : 0);
  const total = conceptos.reduce((s, c) => s + valorNumerico(c), 0);

  const reiniciarFormulario = () => {
    setFecha(hoyBogotaIso());
    setConceptos([conceptoVacio()]);
  };

  const guardarMutation = trpc.clients.cuentasCobro.guardar.useMutation({
    onSuccess: (data) => {
      toast.success(`Cuenta de cobro AP - ${String(data.numero).padStart(4, "0")} generada por ${fmt(data.total)}`);
      if (data.signedUrl) window.open(data.signedUrl, "_blank");
      reiniciarFormulario();
      utils.clients.cuentasCobro.listar.invalidate();
      utils.clients.cuentasCobro.siguienteNumero.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo generar la cuenta de cobro"),
  });

  const eliminarMutation = trpc.clients.cuentasCobro.eliminar.useMutation({
    onSuccess: () => {
      toast.success("Cuenta de cobro eliminada");
      utils.clients.cuentasCobro.listar.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo eliminar la cuenta de cobro"),
  });

  const actualizarConcepto = (id: number, cambios: Partial<ConceptoForm>) => {
    setConceptos((prev) => prev.map((c) => (c.id === id ? { ...c, ...cambios } : c)));
  };

  const agregarConcepto = () => {
    const nuevo = conceptoVacio();
    setConceptos((prev) => [...prev, nuevo]);
    setIdParaEnfocar(nuevo.id);
  };

  const quitarConcepto = (id: number) => {
    setConceptos((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  };

  const handleGuardar = () => {
    if (!clientId) {
      toast.error("Elige el cliente");
      return;
    }
    if (!fecha) {
      toast.error("Elige la fecha de la cuenta de cobro");
      return;
    }
    // Las filas que quedaron totalmente vacías se ignoran; una fila a medio
    // llenar sí se reporta para que no se pierda un valor sin darse cuenta.
    const llenos = conceptos.filter((c) => c.detalle.trim() || c.valor);
    if (llenos.length === 0) {
      toast.error("Agrega al menos un concepto con su detalle y valor");
      return;
    }
    const incompleto = llenos.findIndex((c) => !c.detalle.trim() || valorNumerico(c) <= 0);
    if (incompleto >= 0) {
      const posicion = conceptos.indexOf(llenos[incompleto]) + 1;
      toast.error(`El concepto ${posicion} necesita detalle y un valor mayor a cero`);
      return;
    }
    guardarMutation.mutate({
      clientId: Number(clientId), prefijo: "AP", fecha,
      conceptos: llenos.map((c) => ({ detalle: c.detalle.trim(), valor: valorNumerico(c) })),
    });
  };

  const handleEliminar = (cta: any) => {
    if (!window.confirm(`¿Eliminar la cuenta de cobro ${cta.prefijo} - ${String(cta.numero).padStart(4, "0")} de ${cta.clienteNombre}? Esta acción no se puede deshacer.`)) return;
    eliminarMutation.mutate({ id: cta.id });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-base font-semibold flex items-center gap-1.5"><Receipt className="w-4 h-4" /> Generar cuenta de cobro</p>
          <div className="grid sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs">Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elegir cliente..." /></SelectTrigger>
                <SelectContent>
                  {(clientesQuery.data || []).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {clientesConCta.has(c.id) ? "✓ " : ""}{c.razonSocial}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="cta-fecha">Fecha</Label>
              <Input id="cta-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Próximo folio</Label>
              <Input value={siguienteNumeroQuery.data ? `AP - ${String(siguienteNumeroQuery.data.numero).padStart(4, "0")}` : "..."} disabled className="h-9 text-sm bg-muted" />
            </div>
          </div>

          {clientId && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">Cliente</span><span className="font-medium text-right min-w-0">{clienteSeleccionado?.razonSocial}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">NIT</span><span className="text-right">{clienteSeleccionado?.nit}{clienteSeleccionado?.digitoVerificacion ? `-${clienteSeleccionado.digitoVerificacion}` : ""}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">Dirección</span><span className="text-right min-w-0">{clienteSeleccionado?.direccion || "sin registrar"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">Teléfono</span><span className="text-right">{clienteSeleccionado?.telefono || "sin registrar"}</span></div>
            </div>
          )}

          <div className="space-y-2">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground px-0.5">
              <span className="w-6 shrink-0 text-center">#</span>
              <span className="flex-1 min-w-0">Concepto</span>
              <span className="w-40 shrink-0 text-right pr-3">Valor</span>
              <span className="w-9 shrink-0" />
            </div>
            {conceptos.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                <Input
                  ref={(el) => { if (el) refsDetalle.current.set(c.id, el); else refsDetalle.current.delete(c.id); }}
                  value={c.detalle}
                  onChange={(e) => actualizarConcepto(c.id, { detalle: e.target.value })}
                  placeholder={i === 0 ? "Ej. Honorarios contables Septiembre 2026" : "Detalle del concepto"}
                  aria-label={`Detalle del concepto ${i + 1}`}
                  className="h-9 text-sm flex-1 min-w-0"
                />
                <div className="relative w-32 sm:w-40 shrink-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    inputMode="numeric"
                    value={c.valor ? Number(c.valor).toLocaleString("es-CO") : ""}
                    onChange={(e) => actualizarConcepto(c.id, { valor: e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 12) })}
                    onKeyDown={(e) => { if (e.key === "Enter" && i === conceptos.length - 1) { e.preventDefault(); agregarConcepto(); } }}
                    placeholder="0"
                    aria-label={`Valor del concepto ${i + 1}`}
                    className="h-9 text-sm text-right pl-6 tabular-nums"
                  />
                </div>
                <Button
                  type="button" size="sm" variant="ghost"
                  className="w-9 h-9 p-0 shrink-0 text-muted-foreground hover:text-red-600"
                  onClick={() => quitarConcepto(c.id)}
                  disabled={conceptos.length === 1}
                  title={conceptos.length === 1 ? "La cuenta necesita al menos un concepto" : "Quitar concepto"}
                  aria-label={`Quitar concepto ${i + 1}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={agregarConcepto} disabled={conceptos.length >= 30}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Agregar concepto
              </Button>
              <div className="flex items-baseline gap-3 rounded-md bg-muted/40 px-3 py-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total</span>
                <span className="text-base font-semibold tabular-nums">{fmt(total)}</span>
              </div>
            </div>
          </div>

          <Button onClick={handleGuardar} disabled={guardarMutation.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
            {guardarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Receipt className="w-4 h-4 mr-2" />}
            Guardar y generar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-base font-semibold mb-3">Cuentas de cobro generadas</p>
          {listaQuery.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : !listaQuery.data || listaQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha generado ninguna cuenta de cobro.</p>
          ) : (
            <div className="space-y-2">
              {listaQuery.data.map((cta: any) => {
                const cantidadConceptos = cta.conceptos?.length ?? 1;
                return (
                  <div key={cta.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{cta.prefijo} - {String(cta.numero).padStart(4, "0")} · {cta.clienteNombre}</p>
                      <p className="text-xs text-muted-foreground truncate" title={(cta.conceptos || []).map((c: any) => `${c.detalle}: ${fmt(c.valor)}`).join("\n")}>
                        {formatearFechaCuenta(cta.fecha)}
                        {cantidadConceptos > 1 ? ` · ${cantidadConceptos} conceptos` : ""} · {cta.detalle}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">{fmt(cta.valor)}</span>
                    {cta.signedUrl && (
                      <Button size="sm" variant="outline" className="shrink-0 h-8" onClick={() => window.open(cta.signedUrl, "_blank")} title="Descargar PDF">
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {puedeEliminar && (
                      <Button
                        size="sm" variant="outline"
                        className="shrink-0 h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => handleEliminar(cta)}
                        disabled={eliminarMutation.isPending}
                        title="Eliminar cuenta de cobro"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
