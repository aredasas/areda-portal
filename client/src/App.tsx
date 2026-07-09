import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Clientes from "./pages/Clientes";
import Tareas from "./pages/Tareas";
import Vencimientos from "./pages/Vencimientos";
import Colaboradores from "./pages/Colaboradores";
import Documentos from "./pages/Documentos";
import Configuracion from "./pages/Configuracion";
import Revision from "./pages/Revision";
import Asistencia from "./pages/Asistencia";
import Asistente from "./pages/Asistente";
import CambiarClave from "./pages/CambiarClave";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/clientes"} component={Clientes} />
      <Route path={"/tareas"} component={Tareas} />
      <Route path={"/vencimientos"} component={Vencimientos} />
      <Route path={"/documentos"} component={Documentos} />
      <Route path={"/colaboradores"} component={Colaboradores} />
      <Route path={"/configuracion"} component={Configuracion} />
      <Route path={"/revision"} component={Revision} />
      <Route path={"/asistencia"} component={Asistencia} />
      <Route path={"/asistente"} component={Asistente} />
      <Route path={"/cambiar-clave"} component={CambiarClave} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
