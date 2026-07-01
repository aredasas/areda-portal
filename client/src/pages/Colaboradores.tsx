import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Users, UserCog, Shield, Loader2, Plus, Filter, Search, KeyRound, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  contador_senior: "Contador Senior",
  contador_junior: "Contador Junior",
  asistente: "Asistente",
};

const roleBadgeColors: Record<string, string> = {
  admin: "bg-[#42302E] text-white",
  contador_senior: "bg-[#EDA011] text-white",
  contador_junior: "bg-[#A9AD94] text-white",
  asistente: "bg-[#F6DAAB] text-[#42302E]",
};

export default function Colaboradores() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const { data: collaborators, isLoading, refetch } = trpc.collaborators.list.useQuery();
  const createCollaborator = trpc.collaborators.create.useMutation();
  const updateCollaborator = trpc.collaborators.update.useMutation();
  const deactivateCollaborator = trpc.collaborators.deactivate.useMutation();
  const activateCollaborator = trpc.collaborators.activate.useMutation();
  const resetPasswordMut = trpc.collaborators.resetPassword.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [form, setForm] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    cedula: "",
    role: "asistente" as string,
    phone: "",
    position: "",
  });

  const resetForm = () => {
    setForm({ name: "", email: "", username: "", password: "", cedula: "", role: "asistente", phone: "", position: "" });
    setEditingUser(null);
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold">Acceso Restringido</h2>
          <p className="text-muted-foreground">Solo los administradores pueden gestionar colaboradores.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!form.name || !form.username) {
      toast.error("Nombre y usuario son obligatorios");
      return;
    }
    try {
      if (editingUser) {
        await updateCollaborator.mutateAsync({
          id: editingUser.id,
          name: form.name,
          email: form.email || undefined,
          username: form.username,
          cedula: form.cedula || undefined,
          role: form.role as any,
          phone: form.phone || undefined,
          position: form.position || undefined,
        });
        toast.success("Colaborador actualizado");
      } else {
        if (!form.password || form.password.length < 6) {
          toast.error("La contraseña debe tener al menos 6 caracteres");
          return;
        }
        await createCollaborator.mutateAsync({
          name: form.name,
          email: form.email || undefined,
          username: form.username,
          password: form.password,
          cedula: form.cedula || undefined,
          role: form.role as any,
          phone: form.phone || undefined,
          position: form.position || undefined,
        });
        toast.success("Colaborador creado exitosamente");
      }
      refetch();
      setShowForm(false);
      resetForm();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar");
    }
  };

  const handleEdit = (user: any) => {
    setEditingUser(user);
    setForm({
      name: user.name || "",
      email: user.email || "",
      username: user.username || "",
      password: "",
      cedula: user.cedula || "",
      role: user.role || "asistente",
      phone: user.phone || "",
      position: user.position || "",
    });
    setShowForm(true);
  };

  const handleToggleActive = async (user: any) => {
    try {
      if (user.isActive) {
        await deactivateCollaborator.mutateAsync({ id: user.id });
        toast.success("Colaborador desactivado");
      } else {
        await activateCollaborator.mutateAsync({ id: user.id });
        toast.success("Colaborador activado");
      }
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error");
    }
  };

  const handleResetPassword = async () => {
    if (!resetUserId || !newPassword || newPassword.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    try {
      await resetPasswordMut.mutateAsync({ id: resetUserId, newPassword });
      toast.success("Contraseña restablecida");
      setShowResetPassword(false);
      setNewPassword("");
      setResetUserId(null);
    } catch (error: any) {
      toast.error(error.message || "Error al restablecer contraseña");
    }
  };

  const filtered = (collaborators || []).filter((u: any) => {
    const matchesSearch = !searchTerm ||
      u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.cedula?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = filterRole === "all" || u.role === filterRole;
    const matchesStatus = filterStatus === "all" ||
      (filterStatus === "active" ? u.isActive : !u.isActive);
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E]">Colaboradores</h1>
          <p className="text-muted-foreground mt-1">Gestión del equipo de trabajo</p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant="outline" className="gap-1">
            <Users className="h-3 w-3" />
            {collaborators?.filter((u: any) => u.isActive).length || 0} activos
          </Badge>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
            <Plus className="h-4 w-4" /> Nuevo Colaborador
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre, usuario, cédula..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Rol" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los roles</SelectItem>
            <SelectItem value="admin">Administrador</SelectItem>
            <SelectItem value="contador_senior">Contador Senior</SelectItem>
            <SelectItem value="contador_junior">Contador Junior</SelectItem>
            <SelectItem value="asistente">Asistente</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Cédula</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((user: any) => (
                  <TableRow key={user.id} className={!user.isActive ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{user.name || "-"}</TableCell>
                    <TableCell className="text-sm">{user.username || "-"}</TableCell>
                    <TableCell className="text-sm">{user.cedula || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.email || "-"}</TableCell>
                    <TableCell>
                      <Badge className={roleBadgeColors[user.role] || ""}>{roleLabels[user.role] || user.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? "default" : "secondary"} className={user.isActive ? "bg-green-100 text-green-800" : ""}>
                        {user.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(user)}>Editar</Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setResetUserId(user.id); setShowResetPassword(true); }} title="Restablecer contraseña">
                          <KeyRound className="w-3.5 h-3.5" />
                        </Button>
                        {user.id !== currentUser?.id && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggleActive(user)} title={user.isActive ? "Desactivar" : "Activar"}>
                            {user.isActive ? <UserX className="w-3.5 h-3.5 text-red-500" /> : <UserCheck className="w-3.5 h-3.5 text-green-500" />}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No hay colaboradores que coincidan con los filtros</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingUser ? <UserCog className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              {editingUser ? "Editar Colaborador" : "Nuevo Colaborador"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre completo *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre completo" />
              </div>
              <div className="space-y-2">
                <Label>Cédula</Label>
                <Input value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} placeholder="Número de cédula" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Usuario (para login) *</Label>
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Cédula o nombre de usuario" />
              </div>
              {!editingUser && (
                <div className="space-y-2">
                  <Label>Contraseña inicial *</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email (opcional, puede ser compartido)</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="correo@aredasas.com" />
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="3001234567" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rol *</Label>
                <Select value={form.role} onValueChange={(val) => setForm({ ...form, role: val })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="contador_senior">Contador Senior</SelectItem>
                    <SelectItem value="contador_junior">Contador Junior</SelectItem>
                    <SelectItem value="asistente">Asistente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cargo</Label>
                <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Ej: Contador Principal" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createCollaborator.isPending || updateCollaborator.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
              {(createCollaborator.isPending || updateCollaborator.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingUser ? "Guardar Cambios" : "Crear Colaborador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={showResetPassword} onOpenChange={(open) => { if (!open) { setShowResetPassword(false); setNewPassword(""); setResetUserId(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> Restablecer Contraseña
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label>Nueva contraseña</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowResetPassword(false); setNewPassword(""); }}>Cancelar</Button>
            <Button onClick={handleResetPassword} disabled={resetPasswordMut.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
              {resetPasswordMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Restablecer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
