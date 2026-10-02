import { describe, expect, it } from "vitest";
import {
  asuntoDeRespuesta, codificarEncabezado, componerCuerpoHtml, construirMimeRespuesta, decodificarEncabezado,
  extraerTexto, htmlATexto, interpretarMensaje, limpiarCuerpo, parsearDireccion, textoAHtml, traducirErrorGmail,
} from "./gmail";
import {
  buscarCarpetaDeCliente, construirIndiceClientes, detectarCliente, diasARevisar, firmaHtmlATexto,
  interpretarRespuestaClasificacion, mensajeTodosFallaron, palabrasClave, redactarResumenCorreo,
} from "./oficinaCorreoDb";

const b64url = (texto: string) => Buffer.from(texto, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("gmail — direcciones y encabezados", () => {
  it("separa nombre y correo, con y sin comillas", () => {
    expect(parsearDireccion('"Pérez, Ana" <Ana.Perez@Cliente.co>')).toEqual({ nombre: "Pérez, Ana", email: "ana.perez@cliente.co" });
    expect(parsearDireccion("DIAN <notificaciones@dian.gov.co>")).toEqual({ nombre: "DIAN", email: "notificaciones@dian.gov.co" });
    expect(parsearDireccion("solo@correo.com")).toEqual({ nombre: null, email: "solo@correo.com" });
    expect(parsearDireccion("<solo@correo.com>")).toEqual({ nombre: null, email: "solo@correo.com" });
    expect(parsearDireccion("")).toEqual({ nombre: null, email: "" });
    expect(parsearDireccion(undefined)).toEqual({ nombre: null, email: "" });
  });

  it("decodifica palabras codificadas RFC 2047 (B y Q)", () => {
    expect(decodificarEncabezado("=?UTF-8?B?RGVjbGFyYWNpw7NuIGRlIHJlbnRh?=")).toBe("Declaración de renta");
    expect(decodificarEncabezado("=?iso-8859-1?Q?Informaci=F3n_ex=F3gena?=")).toBe("Información exógena");
    expect(decodificarEncabezado("=?UTF-8?B?RGVjbGFyYWNpw7Nu?= =?UTF-8?B?IGRlIHJlbnRh?=")).toBe("Declaración de renta");
    expect(decodificarEncabezado("Asunto normal")).toBe("Asunto normal");
  });

  it("codifica encabezados con tildes y deja pasar ASCII", () => {
    expect(codificarEncabezado("Re: Factura 123")).toBe("Re: Factura 123");
    const codificado = codificarEncabezado("Re: Declaración de renta año gravable 2025 — información pendiente del cliente");
    for (const palabra of codificado.split("\r\n ")) {
      expect(palabra).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(palabra.length).toBeLessThanOrEqual(75);
    }
    expect(decodificarEncabezado(codificado.replace(/\r\n /g, " "))).toBe("Re: Declaración de renta año gravable 2025 — información pendiente del cliente");
  });

  it("no duplica el Re: del asunto", () => {
    expect(asuntoDeRespuesta("Solicitud de certificado")).toBe("Re: Solicitud de certificado");
    expect(asuntoDeRespuesta("RE: Solicitud de certificado")).toBe("RE: Solicitud de certificado");
    expect(asuntoDeRespuesta("re : algo")).toBe("re : algo");
    expect(asuntoDeRespuesta("  ")).toBe("Re:");
  });
});

describe("gmail — cuerpo del mensaje", () => {
  it("prefiere text/plain e ignora adjuntos", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64url("Buenos días, adjunto la información.") } },
            { mimeType: "text/html", body: { data: b64url("<p>Buenos días, <b>adjunto</b> la información.</p>") } },
          ],
        },
        { mimeType: "text/plain", filename: "notas.txt", body: { data: b64url("contenido del adjunto") } },
      ],
    };
    expect(extraerTexto(payload)).toBe("Buenos días, adjunto la información.");
  });

  it("si solo hay HTML lo convierte a texto", () => {
    const html = "<html><head><style>p{color:red}</style></head><body><p>Hola&nbsp;Arlex,</p><p>Saldo: $1.000 &amp; listo<br>Gracias</p></body></html>";
    const texto = limpiarCuerpo(extraerTexto({ mimeType: "text/html", body: { data: b64url(html) } }), 500);
    expect(texto).toBe("Hola Arlex,\n Saldo: $1.000 & listo\nGracias");
    expect(htmlATexto("<script>alert(1)</script>ok")).toContain("ok");
    expect(htmlATexto("<script>alert(1)</script>ok")).not.toContain("alert");
  });

  it("corta el historial citado y las líneas con >", () => {
    const cuerpo = "Hola, ¿me confirmas la fecha?\n\nGracias.\n\nEl lun, 28 sept 2026 a las 10:15, Arlex Pineda (<contacto@aredasas.com>) escribió:\n> Te envío la cuenta de cobro.\n> Saludos";
    expect(limpiarCuerpo(cuerpo, 500)).toBe("Hola, ¿me confirmas la fecha?\n\nGracias.");
    expect(limpiarCuerpo("Respuesta corta\n> cita\n> otra cita\nFin", 500)).toBe("Respuesta corta\nFin");
    const outlook = "De acuerdo.\n\nDe: Arlex Pineda\nEnviado: lunes, 28 de septiembre\nPara: Cliente\nAsunto: RE: algo\n\nTexto viejo";
    expect(limpiarCuerpo(outlook, 500)).toBe("De acuerdo.");
  });

  it("no deja vacío un reenvío cuyo contenido es el mensaje citado", () => {
    const reenvio = "---------- Forwarded message ---------\nDe: DIAN\nRequerimiento ordinario 123";
    expect(limpiarCuerpo(reenvio, 500)).toContain("Requerimiento ordinario 123");
  });

  it("recorta al máximo indicado", () => {
    const largo = limpiarCuerpo("a".repeat(2000), 100);
    expect(largo.startsWith("a".repeat(100))).toBe(true);
    expect(largo.length).toBeLessThan(110);
  });

  it("interpreta un mensaje completo de la API", () => {
    const mensaje = interpretarMensaje({
      id: "18f0a", threadId: "18f00", internalDate: String(Date.UTC(2026, 8, 30, 15, 0, 0)),
      snippet: "Buenos d&#237;as, necesito el certificado", labelIds: ["INBOX", "UNREAD"],
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: '"Laura Gómez" <laura@colfamil.com.co>' },
          { name: "Reply-To", value: "contabilidad@colfamil.com.co" },
          { name: "To", value: "contacto@aredasas.com" },
          { name: "Subject", value: "Certificado de retenciones" },
          { name: "Message-ID", value: "<abc123@mail.colfamil.com.co>" },
        ],
        body: { data: b64url("Buenos días, necesito el certificado de retenciones de agosto.") },
      },
    }, 1500);
    expect(mensaje).toMatchObject({
      id: "18f0a", threadId: "18f00", remitenteNombre: "Laura Gómez", remitenteEmail: "laura@colfamil.com.co",
      responderA: "contabilidad@colfamil.com.co", asunto: "Certificado de retenciones",
      snippet: "Buenos días, necesito el certificado", messageIdHeader: "<abc123@mail.colfamil.com.co>", esMasivo: false,
      texto: "Buenos días, necesito el certificado de retenciones de agosto.",
    });
    expect(mensaje.fecha.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  it("reconoce envíos masivos por encabezado o etiqueta", () => {
    const base = { id: "1", threadId: "1", internalDate: "1", payload: { headers: [{ name: "From", value: "a@b.co" }] } };
    expect(interpretarMensaje({ ...base, labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }, 100).esMasivo).toBe(true);
    expect(interpretarMensaje({ ...base, payload: { headers: [{ name: "From", value: "a@b.co" }, { name: "List-Unsubscribe", value: "<mailto:x@y.z>" }] } }, 100).esMasivo).toBe(true);
    expect(interpretarMensaje({ ...base, labelIds: ["INBOX", "CATEGORY_PERSONAL"] }, 100).esMasivo).toBe(false);
  });
});

describe("gmail — borrador de respuesta", () => {
  const decodificarCuerpo = (mime: string) => Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf-8");

  it("arma un mensaje RFC 822 enlazado al hilo, con tildes intactas", () => {
    const mime = construirMimeRespuesta({
      deEmail: "contacto@aredasas.com", deNombre: "Arlex Pineda",
      paraEmail: "laura@colfamil.com.co", paraNombre: "Laura Gómez",
      asunto: "Re: Certificado de retenciones", cuerpo: "Buenos días, Laura:\n\nAdjunto el certificado de agosto.\n\nArlex",
      inReplyTo: "<abc123@mail.colfamil.com.co>", references: "<anterior@mail.colfamil.com.co>",
    });
    const [encabezados] = mime.split("\r\n\r\n");
    expect(encabezados).toContain('From: "Arlex Pineda" <contacto@aredasas.com>');
    expect(encabezados).toMatch(/To: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <laura@colfamil\.com\.co>/);
    expect(encabezados).toContain("Subject: Re: Certificado de retenciones");
    expect(encabezados).toContain("In-Reply-To: <abc123@mail.colfamil.com.co>");
    expect(encabezados).toContain("References: <anterior@mail.colfamil.com.co> <abc123@mail.colfamil.com.co>");
    expect(encabezados).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decodificarCuerpo(mime)).toBe("Buenos días, Laura:\r\n\r\nAdjunto el certificado de agosto.\r\n\r\nArlex");
    for (const linea of mime.split("\r\n")) expect(linea.length).toBeLessThanOrEqual(78);
  });

  it("un asunto o remitente malicioso no puede colar encabezados", () => {
    const mime = construirMimeRespuesta({
      deEmail: "contacto@aredasas.com",
      paraEmail: "victima@x.co\r\nBcc: atacante@mal.co", paraNombre: 'Nombre"\r\nBcc: otro@mal.co',
      asunto: "Re: hola\r\nBcc: atacante@mal.co", cuerpo: "texto",
      inReplyTo: "<id@x>\r\nBcc: atacante@mal.co",
    });
    const encabezados = mime.split("\r\n\r\n")[0].split("\r\n");
    expect(encabezados.filter(l => /^bcc:/i.test(l))).toEqual([]);
    expect(encabezados.filter(l => /^(From|To|Subject|In-Reply-To|References|MIME-Version|Content-Type|Content-Transfer-Encoding):/.test(l)).length).toBe(encabezados.length);
  });
});

describe("gmail — errores traducidos", () => {
  it("explica cada causa conocida en español", () => {
    expect(traducirErrorGmail({ response: { data: { error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method" } } }, "a@aredasas.com")).toContain("Delegación en todo el dominio");
    expect(traducirErrorGmail({ response: { data: { error: "invalid_grant", error_description: "Invalid email or User ID" } } }, "noexiste@aredasas.com")).toContain("noexiste@aredasas.com");
    expect(traducirErrorGmail({ code: 403, response: { data: { error: { code: 403, message: "Gmail API has not been used in project 123 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] } } } }, "a@aredasas.com")).toContain("API de Gmail no está activada");
    expect(traducirErrorGmail({ code: 400, response: { data: { error: { code: 400, message: "Mail service not enabled", status: "FAILED_PRECONDITION" } } } }, "grupo@aredasas.com")).toContain("no tiene Gmail activo");
    expect(traducirErrorGmail({ code: 429, message: "Too many requests" }, "a@aredasas.com")).toContain("limitó temporalmente");
    expect(traducirErrorGmail({ message: "socket hang up" }, "a@aredasas.com")).toContain("socket hang up");
  });
});

describe("agente de correo — reconocer al cliente", () => {
  const indice = construirIndiceClientes([
    { id: 1, email: "gerencia@colfamil.com.co; contabilidad@colfamil.com.co" },
    { id: 2, email: "juan.perez@gmail.com" },
    { id: 3, email: "admin@mitierra.co" },
    { id: 4, email: "otro@mitierra.co" },
    { id: 5, email: null },
    { id: 6, email: "asistente@aredasas.com" },
  ], ["aredasas.com"]);

  it("por correo exacto", () => {
    expect(detectarCliente("Gerencia@Colfamil.com.co", indice)).toBe(1);
    expect(detectarCliente("juan.perez@gmail.com", indice)).toBe(2);
  });
  it("por dominio propio cuando es de un solo cliente", () => {
    expect(detectarCliente("laura@colfamil.com.co", indice)).toBe(1);
  });
  it("nunca por dominio público ni por el dominio de la firma", () => {
    expect(detectarCliente("otra.persona@gmail.com", indice)).toBeNull();
    expect(detectarCliente("colega@aredasas.com", indice)).toBeNull();
  });
  it("dominio compartido por dos clientes queda sin asignar (salvo correo exacto)", () => {
    expect(detectarCliente("nuevo@mitierra.co", indice)).toBeNull();
    expect(detectarCliente("admin@mitierra.co", indice)).toBe(3);
  });
  it("remitentes vacíos o desconocidos", () => {
    expect(detectarCliente("", indice)).toBeNull();
    expect(detectarCliente("alguien@desconocido.com", indice)).toBeNull();
  });
});

describe("agente de correo — respuesta de la IA", () => {
  it("lee el JSON aunque venga con texto o markdown alrededor", () => {
    const texto = 'Aquí está:\n```json\n[{"n":1,"categoria":"entidad","prioridad":"urgente","resumen":"La DIAN pide soportes antes del 5 de octubre.","accion":"Reunir soportes"},{"n":2,"categoria":"boletin","prioridad":"ninguna","resumen":"Publicidad","accion":""}]\n```';
    expect(interpretarRespuestaClasificacion(texto, 2)).toEqual([
      { categoria: "entidad", prioridad: "urgente", resumen: "La DIAN pide soportes antes del 5 de octubre.", accion: "Reunir soportes" },
      { categoria: "boletin", prioridad: "ninguna", resumen: "Publicidad", accion: "" },
    ]);
  });
  it("respeta el número de cada correo aunque lleguen desordenados o falte uno", () => {
    const r = interpretarRespuestaClasificacion('[{"n":3,"categoria":"cliente","prioridad":"atencion","resumen":"c","accion":""},{"n":1,"categoria":"otro","prioridad":"info","resumen":"a","accion":""}]', 3);
    expect(r[0]?.resumen).toBe("a");
    expect(r[1]).toBeNull();
    expect(r[2]?.resumen).toBe("c");
  });
  it("descarta prioridades inventadas y normaliza categorías desconocidas", () => {
    const r = interpretarRespuestaClasificacion('[{"n":1,"categoria":"vip","prioridad":"ATENCION","resumen":"x"},{"n":2,"categoria":"cliente","prioridad":"critica","resumen":"y"}]', 2);
    expect(r[0]).toEqual({ categoria: "otro", prioridad: "atencion", resumen: "x", accion: "" });
    expect(r[1]).toBeNull();
  });
  it("respuesta ilegible → todo sin clasificar", () => {
    expect(interpretarRespuestaClasificacion("No pude procesar la lista.", 2)).toEqual([null, null]);
    expect(interpretarRespuestaClasificacion("[{mal json]", 1)).toEqual([null]);
    expect(interpretarRespuestaClasificacion('{"n":1}', 1)).toEqual([null]);
  });
});

describe("agente de correo — ventana y resumen", () => {
  const ahora = new Date("2026-10-02T15:00:00Z");
  it("calcula cuántos días mirar hacia atrás", () => {
    expect(diasARevisar(null, ahora)).toBe(3);
    expect(diasARevisar(new Date("2026-10-02T14:00:00Z"), ahora)).toBe(2);
    expect(diasARevisar(new Date("2026-09-29T15:00:00Z"), ahora)).toBe(4);
    expect(diasARevisar(new Date("2026-08-01T00:00:00Z"), ahora)).toBe(14);
  });

  const r = (nombre: string, extra: Partial<Parameters<typeof redactarResumenCorreo>[0][number]>) =>
    ({ nombre, nuevos: 0, atencion: 0, urgentes: 0, porProcesar: 0, sinClasificar: 0, error: null, ...extra });

  it("resume con conteos exactos y concordancia de número", () => {
    expect(redactarResumenCorreo([r("Arlex", {})])).toBe("Revisé 1 buzón: no hay correos nuevos.");
    expect(redactarResumenCorreo([r("Arlex", { nuevos: 5 }), r("Contabilidad", { nuevos: 2 })]))
      .toBe("Revisé 2 buzones: 7 correos nuevos, ninguno requiere tu atención.");
    expect(redactarResumenCorreo([r("Arlex", { nuevos: 9, urgentes: 1, atencion: 3 }), r("Contabilidad", { nuevos: 3, urgentes: 1 })]))
      .toBe("Revisé 2 buzones: 12 correos nuevos — 2 urgentes y 3 que requieren atención.");
    expect(redactarResumenCorreo([r("Arlex", { nuevos: 1, atencion: 1 })]))
      .toBe("Revisé 1 buzón: 1 correo nuevo — 1 que requiere atención.");
  });
  it("avisa lo que quedó pendiente y los buzones que fallaron", () => {
    expect(redactarResumenCorreo([
      r("Arlex", { nuevos: 40, urgentes: 1, porProcesar: 15, sinClasificar: 2 }),
      r("Contabilidad", { error: "La API de Gmail no está activada." }),
    ])).toBe("Revisé 1 buzón: 40 correos nuevos — 1 urgente. Quedaron 15 correos por leer; vuelve a revisar para continuar. 2 correos no se pudieron clasificar por una falla de la IA; se reintenta en la próxima revisión. No pude leer el buzón Contabilidad: La API de Gmail no está activada.");
  });
  it("cuando no se pudo leer ningún buzón, dice la causa una sola vez", () => {
    const causa = "La cuenta de servicio todavía no está autorizada.";
    expect(mensajeTodosFallaron([{ email: "a@x.co", error: causa }])).toBe(causa);
    expect(mensajeTodosFallaron([{ email: "a@x.co", error: causa }, { email: "b@x.co", error: causa }]))
      .toBe(`No pude leer ninguno de los 2 buzones. ${causa}`);
    expect(mensajeTodosFallaron([
      { email: "a@x.co", error: "No se pudo consultar el buzón a@x.co: timeout" },
      { email: "b@x.co", error: "No se pudo consultar el buzón b@x.co: timeout" },
    ])).toBe("No pude leer ninguno de los 2 buzones. No se pudo consultar el buzón a@x.co: timeout");
    expect(mensajeTodosFallaron([{ email: "a@x.co", error: causa }, { email: "b@x.co", error: "Google no reconoce el buzón b@x.co." }]))
      .toContain("por causas distintas");
  });
});

describe("carpetas de clientes", () => {
  const carpetas = [
    { id: "L1", nombre: "Clientes/Droguerías Colfamil" }, { id: "L2", nombre: "Clientes/SuarezPharma" },
    { id: "L3", nombre: "Mi Tierra" }, { id: "L4", nombre: "Facturas" }, { id: "L5", nombre: "Clientes/Pérez Ospina Oscar" },
    { id: "L6", nombre: "Clientes" }, { id: "L7", nombre: "DIAN" },
  ];
  it("saca las palabras que identifican a un cliente", () => {
    expect(palabrasClave("Droguerías Colfamil S.A.S.")).toEqual(["DROGUERIAS", "COLFAMIL"]);
    expect(palabrasClave("SERVICIOS & REPUESTOS INDUSTRIALES DEL ORIENTE S.A.S.")).toEqual(["SERVICIOS", "REPUESTOS", "INDUSTRIALES", "ORIENTE"]);
    expect(palabrasClave("S.A.S.")).toEqual([]);
  });
  it("mismo nombre (sin tildes, mayúsculas ni S.A.S.) → carpeta segura, también anidada", () => {
    expect(buscarCarpetaDeCliente(carpetas, "DROGUERIAS COLFAMIL S.A.S.").segura?.id).toBe("L1");
    expect(buscarCarpetaDeCliente(carpetas, "SuarezPharma SAS").segura?.id).toBe("L2");
  });
  it("coincidencia parcial → solo sugerida, nunca automática", () => {
    // la carpeta tiene menos palabras que el cliente
    expect(buscarCarpetaDeCliente(carpetas, "Miradores Mi Tierra S.A.S.")).toEqual({ segura: null, sugerida: carpetas[2] });
    // la carpeta tiene más palabras que el cliente
    expect(buscarCarpetaDeCliente(carpetas, "Pérez Ospina")).toEqual({ segura: null, sugerida: carpetas[4] });
  });
  it("sin coincidencia no propone nada; carpetas genéricas no cuentan", () => {
    expect(buscarCarpetaDeCliente(carpetas, "Inversiones El Roble Ltda.")).toEqual({ segura: null, sugerida: null });
    expect(buscarCarpetaDeCliente(carpetas, "Clientes Varios S.A.S.").segura).toBeNull();
    expect(buscarCarpetaDeCliente([], "Droguerías Colfamil")).toEqual({ segura: null, sugerida: null });
  });
  it("dos carpetas con el mismo nombre del cliente: no elige sola", () => {
    const dobles = [{ id: "A", nombre: "Clientes/Colfamil" }, { id: "B", nombre: "Archivo 2025/Colfamil" }];
    const r = buscarCarpetaDeCliente(dobles, "Colfamil S.A.S.");
    expect(r.segura).toBeNull();
    expect(r.sugerida).not.toBeNull();
  });
});

describe("firma y borrador en HTML", () => {
  const firmaHtml = '<div><b>Arlex Pineda Ocampo</b></div><div>Contador P&uacute;blico &amp; Especialista NIIF</div><div><img src="https://x/logo.png"><br>Tel. 318 793 5393</div>';
  it("la firma de Gmail se pasa a texto limpio para la vista previa", () => {
    expect(firmaHtmlATexto(firmaHtml)).toBe("Arlex Pineda Ocampo\nContador P blico & Especialista NIIF\nTel. 318 793 5393");
  });
  it("el texto redactado se escapa y la firma HTML se conserva intacta", () => {
    expect(textoAHtml('Hola <b>Laura</b> & "equipo"\nSegunda línea')).toBe("Hola &lt;b&gt;Laura&lt;/b&gt; &amp; &quot;equipo&quot;<br>\nSegunda línea");
    const html = componerCuerpoHtml("Buenos días.\n\nQuedo atento.", firmaHtml);
    expect(html).toContain("Buenos días.<br>\n<br>\nQuedo atento.");
    expect(html).toContain(`<div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">${firmaHtml}</div>`);
  });
  it("con cuerpo HTML el borrador va en los dos formatos, enlazado al hilo", () => {
    const mime = construirMimeRespuesta({
      deEmail: "contacto@aredasas.com", paraEmail: "laura@colfamil.com.co", asunto: "Re: Certificado",
      cuerpo: "Buenos días.\n\nArlex Pineda Ocampo", cuerpoHtml: componerCuerpoHtml("Buenos días.", firmaHtml), inReplyTo: "<abc@mail>",
    });
    const [encabezados, ...resto] = mime.split("\r\n\r\n");
    expect(encabezados).toMatch(/Content-Type: multipart\/alternative; boundary="([^"]+)"/);
    expect(encabezados).toContain("In-Reply-To: <abc@mail>");
    const limite = /boundary="([^"]+)"/.exec(encabezados)![1];
    const partes = mime.split(`--${limite}`).slice(1, -1);
    expect(partes.length).toBe(2);
    const decodificar = (parte: string) => Buffer.from(parte.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf-8");
    expect(partes[0]).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decodificar(partes[0])).toBe("Buenos días.\r\n\r\nArlex Pineda Ocampo");
    expect(partes[1]).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(decodificar(partes[1])).toContain(firmaHtml);
    expect(mime.endsWith(`--${limite}--\r\n`)).toBe(true);
    expect(resto.length).toBeGreaterThan(0);
    for (const linea of mime.split("\r\n")) expect(linea.length).toBeLessThanOrEqual(78);
  });
  it("el resumen de la revisión avisa de la publicidad que espera autorización", () => {
    const base = { atencion: 0, urgentes: 0, porProcesar: 0, sinClasificar: 0, error: null };
    expect(redactarResumenCorreo([{ ...base, nombre: "Arlex", nuevos: 6, publicidad: 4 }]))
      .toBe("Revisé 1 buzón: 6 correos nuevos, ninguno requiere tu atención. 4 son publicidad: quedan en la lista de Publicidad esperando tu autorización para eliminarlos.");
    expect(redactarResumenCorreo([{ ...base, nombre: "Arlex", nuevos: 1, publicidad: 1 }]))
      .toBe("Revisé 1 buzón: 1 correo nuevo, ninguno requiere tu atención. 1 es publicidad: queda en la lista de Publicidad esperando tu autorización para eliminarlo.");
  });
});
