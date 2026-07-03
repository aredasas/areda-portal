import DashboardLayout from "@/components/DashboardLayout";
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
import { trpc } from "@/lib/trpc";
import { Building2, Plus, Upload, Loader2, Search, FileText, Sparkles, UserCheck } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

export default function Clientes() {
  const { data: clients, isLoading, refetch } = trpc.clients.list.useQuery();
  const { data: obligations } = trpc.obligations.list.useQuery();
  const { data: collaborators } = trpc.collaborators.getActive.useQuery();
  const createClient = trpc.clients.create.useMutation();
  const updateClient = trpc.clients.update.useMutation();
  const uploadRut = trpc.clients.uploadRut.useMutation();
  const extractRut = trpc.clients.extractRutData.useMutation();
  const setObligations = trpc.obligations.setClientObligations.useMutation();

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
    notes: "",
  });

  const resetForm = () => {
    setForm({
      razonSocial: "", nit: "", digitoVerificacion: "", direccion: "",
      ciudad: "", departamento: "", telefono: "", email: "",
      actividadEconomica: "", codigoCIIU: "", representanteLegal: "",
      rutFileUrl: "", rutFileKey: "", managerId: "", notes: "",
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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nombre o NIT..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
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
                    <TableCell className="font-medium">{client.razonSocial}</TableCell>
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
                      <Button variant="outline" size="sm" onClick={() => handleEdit(client)}>Editar</Button>
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
