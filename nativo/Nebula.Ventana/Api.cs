using System;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>Un error contado por el motor, listo para enseñar al usuario.</summary>
    internal sealed class ApiException : Exception
    {
        public ApiException(string mensaje) : base(mensaje) { }
    }

    /// <summary>
    /// Cliente del motor.
    ///
    /// La ventana no toca la biblioteca por su cuenta: pide las cosas por la API
    /// local del núcleo, igual que hacía la interfaz web. Así el motor puede
    /// seguir siendo el de siempre (y pasar a C# por partes más adelante) sin que
    /// la ventana se entere.
    /// </summary>
    internal sealed class Api : IDisposable
    {
        private readonly HttpClient cliente;
        private readonly string raiz;

        public Api(int puerto)
        {
            raiz = "http://127.0.0.1:" + puerto;
            cliente = new HttpClient();
            /* las búsquedas de fichas y los análisis pueden tardar: se deja margen */
            cliente.Timeout = TimeSpan.FromMinutes(10);
        }

        public string Direccion
        {
            get { return raiz; }
        }

        /* ------------------------------------------------------------ peticiones */

        private async Task<JToken> PedirAsync(HttpMethod metodo, string ruta, JObject cuerpo)
        {
            HttpRequestMessage peticion = new HttpRequestMessage(metodo, raiz + ruta);
            try
            {
                if (cuerpo != null)
                {
                    peticion.Content = new StringContent(cuerpo.ToString(Formatting.None), new UTF8Encoding(false), "application/json");
                }
                using (HttpResponseMessage respuesta = await cliente.SendAsync(peticion).ConfigureAwait(false))
                {
                    string texto = await respuesta.Content.ReadAsStringAsync().ConfigureAwait(false);
                    if (!respuesta.IsSuccessStatusCode)
                    {
                        string mensaje = "El programa respondió con un error (" + (int)respuesta.StatusCode + ")";
                        try
                        {
                            JObject datos = JObject.Parse(texto);
                            if (datos["error"] != null) mensaje = datos["error"].ToString();
                        }
                        catch { /* respuesta sin JSON: se queda el mensaje genérico */ }
                        throw new ApiException(mensaje);
                    }
                    if (string.IsNullOrEmpty(texto)) return null;
                    return JToken.Parse(texto);
                }
            }
            finally
            {
                peticion.Dispose();
            }
        }

        private Task<JToken> VerAsync(string ruta)
        {
            return PedirAsync(HttpMethod.Get, ruta, null);
        }

        private Task<JToken> EnviarAsync(string ruta, JObject cuerpo)
        {
            return PedirAsync(HttpMethod.Post, ruta, cuerpo ?? new JObject());
        }

        /* -------------------------------------------------------------- consultas */

        public Task<JToken> EstadoAsync() { return VerAsync("/api/state"); }

        public Task<JToken> LauncherAsync() { return VerAsync("/api/launcher"); }

        public Task<JToken> ScanAsync() { return VerAsync("/api/scan"); }

        public Task<JToken> RaicesAsync() { return VerAsync("/api/roots"); }

        /* --------------------------------------------------------------- acciones */

        public Task<JToken> LanzarAsync(string id)
        {
            return EnviarAsync("/api/games/" + Uri.EscapeDataString(id) + "/launch", new JObject());
        }

        public Task<JToken> DetenerAsync(string id)
        {
            return EnviarAsync("/api/games/" + Uri.EscapeDataString(id) + "/stop", new JObject());
        }

        public Task<JToken> DetenerTodoAsync()
        {
            return EnviarAsync("/api/launcher/stop-all", new JObject());
        }

        public Task<JToken> AbrirCarpetaAsync(string id)
        {
            return EnviarAsync("/api/games/" + Uri.EscapeDataString(id) + "/reveal", new JObject());
        }

        public Task<JToken> ActualizarJuegoAsync(string id, JObject cambios)
        {
            return PedirAsync(new HttpMethod("PATCH"), "/api/games/" + Uri.EscapeDataString(id), cambios);
        }

        public Task<JToken> GuardarAjustesAsync(JObject cambios)
        {
            return PedirAsync(new HttpMethod("PATCH"), "/api/settings", cambios);
        }

        public Task<JToken> AgregarRaizAsync(string ruta, string tipo, bool recursivo)
        {
            JObject cuerpo = new JObject();
            cuerpo["path"] = ruta;
            cuerpo["kind"] = tipo;
            cuerpo["label"] = Path.GetFileName(ruta.TrimEnd('\\', '/'));
            cuerpo["recursive"] = recursivo;
            return EnviarAsync("/api/roots", cuerpo);
        }

        public Task<JToken> QuitarRaizAsync(string id)
        {
            return PedirAsync(HttpMethod.Delete, "/api/roots?id=" + Uri.EscapeDataString(id), null);
        }

        public Task<JToken> AnalizarCarpetaAsync(string ruta, string tipo, bool profundo)
        {
            JObject cuerpo = new JObject();
            cuerpo["path"] = ruta;
            cuerpo["kind"] = tipo;
            cuerpo["deep"] = profundo;
            /* las ROMs se buscan también en subcarpetas, como se guarda la raíz */
            cuerpo["recursive"] = profundo;
            return EnviarAsync("/api/folders", cuerpo);
        }

        public Task<JToken> ImportarAsync(JArray hallazgos)
        {
            JObject cuerpo = new JObject();
            cuerpo["import"] = true;
            cuerpo["findings"] = hallazgos;
            cuerpo["options"] = new JObject(new JProperty("status", "backlog"));
            return EnviarAsync("/api/scan", cuerpo);
        }

        public Task<JToken> EscanearTodoAsync()
        {
            return EnviarAsync("/api/scan", new JObject());
        }

        public Task<JToken> CargarDemoAsync()
        {
            return EnviarAsync("/api/demo", new JObject());
        }

        public Task<JToken> QuitarDemoAsync()
        {
            return PedirAsync(HttpMethod.Delete, "/api/demo", null);
        }

        /* ---------------------------------------------------------------- imágenes */

        /// <summary>Descarga la carátula del juego (la genera el motor si no hay).</summary>
        public async Task<Image> PortadaAsync(string id)
        {
            using (HttpResponseMessage respuesta = await cliente.GetAsync(raiz + "/api/games/" + Uri.EscapeDataString(id) + "/cover").ConfigureAwait(false))
            {
                if (!respuesta.IsSuccessStatusCode) return null;
                byte[] datos = await respuesta.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                if (datos == null || datos.Length == 0) return null;
                try
                {
                    using (MemoryStream memoria = new MemoryStream(datos))
                    using (Image original = Image.FromStream(memoria))
                    {
                        /* se copia para no dejar el flujo abierto (Image lo retiene) */
                        return new Bitmap(original);
                    }
                }
                catch
                {
                    return null;   /* lo que llegó no era una imagen */
                }
            }
        }

        public void Dispose()
        {
            try { cliente.Dispose(); } catch { /* da igual al salir */ }
        }
    }
}
