import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserSquare2, Construction } from "lucide-react";

/** Módulo especial de Renta Persona Natural — separado de Informes, con
 * acceso restringido a Arlex por ahora. En construcción: el diseño se
 * hará con base en el análisis del archivo de referencia (calculadora de
 * Formulario 210) y las instrucciones puntuales que Arlex dará después. */
export default function RentaPersonaNatural() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-semibold">Renta Persona Natural</h1>
          <p className="text-muted-foreground text-sm">
            Apoyo para la declaración de renta de persona natural — calendario de vencimientos propio y
            clientes propios de este módulo
          </p>
        </div>

        <Card className="border-dashed">
          <CardContent className="py-14 flex flex-col items-center text-center gap-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <UserSquare2 className="w-5 h-5" />
              <Construction className="w-4 h-4" />
            </div>
            <h3 className="font-medium">En construcción</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Subir el archivo de información exógena de la DIAN, digitar los datos adicionales que
              requiera el contador (junto con la declaración anterior), y generar un borrador del
              Formulario 210 listo para subir, con sus anexos de ingresos y patrimonio.
            </p>
            <Badge variant="outline" className="text-xs">Instrucciones pendientes</Badge>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
