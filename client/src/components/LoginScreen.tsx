import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const utils = trpc.useUtils();
  const loginMutation = trpc.auth.localLogin.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      toast.success("Sesión iniciada correctamente");
    },
    onError: (err) => {
      setError(err.message || "Error al iniciar sesión");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Ingrese usuario y contraseña");
      return;
    }
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{
        background:
          "linear-gradient(135deg, #42302E 0%, #5a4240 50%, #42302E 100%)",
      }}
    >
      <div className="flex flex-col items-center gap-6 p-10 max-w-md w-full bg-white rounded-2xl shadow-2xl">
        <div className="flex flex-col items-center gap-3">
          <img
            src="https://assets.zyrosite.com/A0x38ZWxPKt66ygM/group-292-A0xrkNGgxrh4G9QM.png"
            alt="Areda Consultores"
            className="h-20 w-20 rounded-xl object-contain"
          />
          <div className="flex items-center gap-1.5">
            <span
              className="text-3xl font-bold tracking-tight"
              style={{ color: "#42302E" }}
            >
              AREDA
            </span>
            <span className="text-lg font-medium" style={{ color: "#EDA011" }}>
              Work
            </span>
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Portal de gestión tributaria y tareas para el equipo contable.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium">
              Usuario o Cédula
            </Label>
            <Input
              id="username"
              type="text"
              placeholder="Ingrese su usuario o número de cédula"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              Contraseña
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Ingrese su contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all h-11"
            style={{ backgroundColor: "#EDA011", color: "#42302E" }}
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Ingresando...
              </>
            ) : (
              "Iniciar Sesión"
            )}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center">
          Acceso exclusivo para colaboradores autorizados.
          <br />
          Contacte al administrador si no tiene credenciales.
        </p>
      </div>
    </div>
  );
}
