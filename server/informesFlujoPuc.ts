/** Nombres de las cuentas del PUC comercial (Decreto 2650 de 1993) a 4
 * dígitos, para las que más aparecen como contrapartida del efectivo. El
 * libro auxiliar solo trae el nombre de la subcuenta ("220505 Nacionales"),
 * no el de la cuenta ("2205 Proveedores nacionales"), así que sin esta
 * tabla el flujo saldría sin nombres. Es solo el respaldo: primero manda
 * el nombre que el contador escriba para el cliente y luego el del plan
 * de cuentas propio del cliente, si lo subió. */
export const NOMBRES_PUC: Record<string, string> = {
  // 11 Disponible
  "1105": "Caja", "1110": "Bancos", "1115": "Remesas en tránsito", "1120": "Cuentas de ahorro", "1125": "Fondos",
  // 12 Inversiones
  "1205": "Acciones", "1225": "Certificados", "1245": "Derechos fiduciarios", "1295": "Otras inversiones",
  // 13 Deudores
  "1305": "Clientes", "1310": "Cuentas corrientes comerciales", "1320": "Cuentas por cobrar a vinculados económicos",
  "1325": "Cuentas por cobrar a socios y accionistas", "1330": "Anticipos y avances", "1335": "Depósitos",
  "1345": "Ingresos por cobrar", "1355": "Anticipo de impuestos y contribuciones", "1360": "Reclamaciones",
  "1365": "Cuentas por cobrar a trabajadores", "1370": "Préstamos a particulares", "1380": "Deudores varios",
  // 14 Inventarios
  "1405": "Materias primas", "1410": "Productos en proceso", "1430": "Productos terminados",
  "1435": "Mercancías no fabricadas por la empresa", "1455": "Materiales, repuestos y accesorios", "1465": "Inventarios en tránsito",
  // 15 Propiedades, planta y equipo
  "1504": "Terrenos", "1508": "Construcciones en curso", "1516": "Construcciones y edificaciones", "1520": "Maquinaria y equipo",
  "1524": "Equipo de oficina", "1528": "Equipo de computación y comunicación", "1532": "Equipo médico-científico",
  "1540": "Flota y equipo de transporte", "1592": "Depreciación acumulada",
  // 16-17 Intangibles y diferidos
  "1605": "Crédito mercantil", "1610": "Marcas", "1635": "Licencias", "1705": "Gastos pagados por anticipado", "1710": "Cargos diferidos",
  // 21 Obligaciones financieras
  "2105": "Bancos nacionales", "2110": "Bancos del exterior", "2115": "Corporaciones financieras",
  "2120": "Compañías de financiamiento comercial", "2145": "Obligaciones gubernamentales", "2195": "Otras obligaciones",
  // 22-23 Proveedores y cuentas por pagar
  "2205": "Proveedores nacionales", "2210": "Proveedores del exterior",
  "2305": "Cuentas corrientes comerciales", "2315": "A compañías vinculadas", "2335": "Costos y gastos por pagar",
  "2355": "Deudas con accionistas o socios", "2360": "Dividendos o participaciones por pagar", "2365": "Retención en la fuente",
  "2367": "Impuesto a las ventas retenido", "2368": "Impuesto de industria y comercio retenido",
  "2370": "Retenciones y aportes de nómina", "2380": "Acreedores varios",
  // 24 Impuestos
  "2404": "De renta y complementarios", "2408": "Impuesto sobre las ventas por pagar", "2412": "De industria y comercio",
  "2495": "Otros impuestos",
  // 25-28 Laborales, estimados, diferidos y otros pasivos
  "2505": "Salarios por pagar", "2510": "Cesantías consolidadas", "2515": "Intereses sobre cesantías",
  "2520": "Prima de servicios", "2525": "Vacaciones consolidadas", "2610": "Provisión para obligaciones laborales",
  "2705": "Ingresos recibidos por anticipado", "2805": "Anticipos y avances recibidos", "2810": "Depósitos recibidos",
  "2815": "Ingresos recibidos para terceros",
  // 3 Patrimonio
  "3105": "Capital suscrito y pagado", "3115": "Aportes sociales", "3130": "Capital de personas naturales",
  "3605": "Utilidad del ejercicio", "3705": "Utilidades acumuladas",
  // 41-42 Ingresos
  "4105": "Agricultura, ganadería, caza y silvicultura", "4120": "Industrias manufactureras", "4130": "Construcción",
  "4135": "Comercio al por mayor y al por menor", "4140": "Hoteles y restaurantes",
  "4145": "Transporte, almacenamiento y comunicaciones", "4150": "Actividad financiera",
  "4155": "Actividades inmobiliarias, empresariales y de alquiler", "4160": "Enseñanza", "4165": "Servicios sociales y de salud",
  "4170": "Otras actividades de servicios comunitarios, sociales y personales", "4175": "Devoluciones en ventas",
  "4205": "Otras ventas", "4210": "Financieros", "4215": "Dividendos y participaciones", "4220": "Arrendamientos",
  "4225": "Comisiones", "4230": "Honorarios", "4235": "Servicios", "4245": "Utilidad en venta de propiedades, planta y equipo",
  "4250": "Recuperaciones", "4255": "Indemnizaciones", "4295": "Diversos",
  // 51 Gastos de administración
  "5105": "Gastos de personal (administración)", "5110": "Honorarios (administración)", "5115": "Impuestos (administración)",
  "5120": "Arrendamientos (administración)", "5125": "Contribuciones y afiliaciones (administración)", "5130": "Seguros (administración)",
  "5135": "Servicios (administración)", "5140": "Gastos legales (administración)", "5145": "Mantenimiento y reparaciones (administración)",
  "5150": "Adecuación e instalación (administración)", "5155": "Gastos de viaje (administración)", "5195": "Diversos (administración)",
  // 52 Gastos de ventas
  "5205": "Gastos de personal (ventas)", "5210": "Honorarios (ventas)", "5215": "Impuestos (ventas)",
  "5220": "Arrendamientos (ventas)", "5225": "Contribuciones y afiliaciones (ventas)", "5230": "Seguros (ventas)",
  "5235": "Servicios (ventas)", "5240": "Gastos legales (ventas)", "5245": "Mantenimiento y reparaciones (ventas)",
  "5250": "Adecuación e instalación (ventas)", "5255": "Gastos de viaje (ventas)", "5295": "Diversos (ventas)",
  // 53-54 No operacionales e impuesto de renta
  "5305": "Gastos financieros", "5310": "Pérdida en venta y retiro de bienes", "5315": "Gastos extraordinarios",
  "5395": "Gastos diversos", "5405": "Impuesto de renta y complementarios",
  // 6-7 Costos
  "6135": "Costo de ventas: comercio al por mayor y al por menor", "6205": "Compras de mercancías", "6225": "Devoluciones en compras",
  "7205": "Mano de obra directa", "7305": "Costos indirectos",
};
