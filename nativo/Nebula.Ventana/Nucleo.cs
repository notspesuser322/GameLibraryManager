using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Nebula.Ventana
{
    /// <summary>
    /// El núcleo: `Nebula-nucleo.exe`.
    ///
    /// Es el motor de la biblioteca (el programa de siempre, con Node dentro):
    /// escanea carpetas, guarda los datos, descarga las fichas y sirve la
    /// interfaz. La ventana nativa no sabe nada de eso: solo lo arranca, espera a
    /// que responda, dibuja la interfaz y, cuando se cierra, se lo lleva consigo.
    /// </summary>
    internal sealed class Nucleo
    {
        private const string NombreNucleo = "Nebula-nucleo.exe";

        private Process proceso;

        /// <summary>Busca el núcleo junto al programa (o en la subcarpeta `nucleo`).</summary>
        public static string Buscar()
        {
            string carpeta = Path.GetDirectoryName(Application.ExecutablePath);
            if (carpeta == null) return null;
            string[] candidatos = new string[]
            {
                Path.Combine(carpeta, NombreNucleo),
                Path.Combine(carpeta, "nucleo", NombreNucleo),
                Path.Combine(carpeta, NombreNucleo.ToLowerInvariant()),
            };
            foreach (string candidato in candidatos)
            {
                try
                {
                    if (File.Exists(candidato)) return candidato;
                }
                catch { /* ruta imposible: se prueba la siguiente */ }
            }
            return null;
        }

        /// <summary>Carpeta de datos del usuario (la misma que usa el núcleo).</summary>
        public static string CarpetaDatos(string deArgumentos)
        {
            if (!string.IsNullOrEmpty(deArgumentos)) return Path.GetFullPath(deArgumentos);
            string baseDatos = Environment.GetEnvironmentVariable("APPDATA");
            if (string.IsNullOrEmpty(baseDatos))
            {
                baseDatos = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Roaming");
            }
            return Path.Combine(baseDatos, "Nebula");
        }

        /// <summary>Carpeta donde WebView2 guarda su caché (dentro de los datos del usuario).</summary>
        public static string CarpetaWebView2(string carpetaDatos)
        {
            return Path.Combine(carpetaDatos, "WebView2");
        }

        /// <summary>¿Está WebView2 en este equipo? (viene con Edge, en Windows 10 y 11)</summary>
        public static bool WebView2Disponible()
        {
            try
            {
                string version = CoreWebView2Environment.GetAvailableBrowserVersionString();
                return !string.IsNullOrEmpty(version);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Arranca el núcleo con los mismos argumentos, más los de la ventana.</summary>
        public void Arrancar(string rutaNucleo, string[] argumentos, int puerto)
        {
            // el núcleo nunca abre ventana propia: la ventana la lleva este programa
            List<string> propios = new List<string>();
            bool tienePuerto = false;
            for (int i = 0; i < argumentos.Length; i++)
            {
                string actual = argumentos[i];
                if (actual == "--open" || actual == "--no-open" || actual == "--browser" ||
                    actual == "--navegador" || actual == "--padre" || actual == "--keep-alive")
                {
                    // --padre lo pone esta ventana; --keep-alive solo habla de la ventana
                    if (actual == "--padre") i++;
                    continue;
                }
                if (actual == "--port" || actual == "-p") tienePuerto = true;
                propios.Add(actual);
            }
            if (!tienePuerto)
            {
                propios.Add("--port");
                propios.Add(puerto.ToString());
            }
            propios.Add("--no-open");
            propios.Add("--padre");
            propios.Add(Process.GetCurrentProcess().Id.ToString());

            ProcessStartInfo inicio = new ProcessStartInfo(rutaNucleo);
            inicio.Arguments = Argumentos.Unir(propios);
            inicio.UseShellExecute = false;
            inicio.CreateNoWindow = true;
            inicio.WindowStyle = ProcessWindowStyle.Hidden;
            inicio.WorkingDirectory = Path.GetDirectoryName(rutaNucleo);

            proceso = Process.Start(inicio);
            if (proceso == null) throw new InvalidOperationException("no se pudo arrancar " + NombreNucleo);
        }

        /// <summary>Arranca el núcleo dejándole la ventana a él (cuando no hay WebView2).</summary>
        public static int Delegar(string rutaNucleo, string[] argumentos)
        {
            List<string> propios = new List<string>();
            bool tieneApertura = false;
            for (int i = 0; i < argumentos.Length; i++)
            {
                string actual = argumentos[i];
                if (actual == "--no-open")
                {
                    tieneApertura = true;
                    continue;
                }
                if (actual == "--open" || actual == "--browser" || actual == "--navegador") tieneApertura = true;
                propios.Add(actual);
            }
            if (!tieneApertura) propios.Add("--open");

            ProcessStartInfo inicio = new ProcessStartInfo(rutaNucleo);
            inicio.Arguments = Argumentos.Unir(propios);
            inicio.UseShellExecute = false;
            inicio.CreateNoWindow = true;
            inicio.WorkingDirectory = Path.GetDirectoryName(rutaNucleo);
            Process hijo = Process.Start(inicio);
            hijo.WaitForExit();
            return hijo.ExitCode;
        }

        /// <summary>Ejecuta el núcleo tal cual y devuelve su código (instalar, desinstalar…).</summary>
        public static int EjecutarYEsperar(string rutaNucleo, string[] argumentos)
        {
            ProcessStartInfo inicio = new ProcessStartInfo(rutaNucleo);
            inicio.Arguments = Argumentos.Unir(new List<string>(argumentos));
            inicio.UseShellExecute = false;
            inicio.CreateNoWindow = true;
            inicio.WorkingDirectory = Path.GetDirectoryName(rutaNucleo);
            Process hijo = Process.Start(inicio);
            hijo.WaitForExit();
            return hijo.ExitCode;
        }

        /// <summary>¿El núcleo ya responde?</summary>
        public static bool Saludable(int puerto)
        {
            try
            {
                HttpWebRequest peticion = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + puerto + "/api/health");
                peticion.Timeout = 1500;
                peticion.ReadWriteTimeout = 1500;
                peticion.Method = "GET";
                using (WebResponse respuesta = peticion.GetResponse())
                using (StreamReader lector = new StreamReader(respuesta.GetResponseStream()))
                {
                    string cuerpo = lector.ReadToEnd();
                    return cuerpo.IndexOf("\"ok\":true", StringComparison.Ordinal) >= 0;
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>¿Sigue vivo el proceso del núcleo?</summary>
        public bool Vivo
        {
            get
            {
                try
                {
                    return proceso != null && !proceso.HasExited;
                }
                catch
                {
                    return false;
                }
            }
        }

        /// <summary>Espera a que el núcleo termine (modo sin ventana propia).</summary>
        public int Esperar()
        {
            if (proceso == null) return 0;
            proceso.WaitForExit();
            return proceso.ExitCode;
        }

        /// <summary>
        /// Pide al núcleo que se cierre y espera un momento. Si hay un juego en
        /// marcha el núcleo responde que sigue pendiente y se queda contando el
        /// tiempo: en ese caso se le deja terminar solo (la ventana ya se cerró).
        /// </summary>
        public void Cerrar(int puerto, bool mantener, int esperaMs)
        {
            if (proceso == null) return;
            if (mantener)
            {
                Salida.Linea("se deja el nucleo en marcha (--keep-alive)");
                return;
            }
            PedirCierre(puerto);
            try
            {
                if (!proceso.WaitForExit(esperaMs))
                {
                    Salida.Linea("el nucleo no termino a tiempo (¿hay un juego en marcha?): se le deja terminar solo");
                }
            }
            catch
            {
                Matar();
            }
        }

        /// <summary>Pide el cierre ordenado por la puerta de atrás del servidor.</summary>
        private static void PedirCierre(int puerto)
        {
            try
            {
                HttpWebRequest peticion = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + puerto + "/api/shutdown");
                peticion.Method = "POST";
                peticion.ContentLength = 0;
                peticion.Timeout = 2000;
                peticion.ReadWriteTimeout = 2000;
                using (WebResponse respuesta = peticion.GetResponse())
                {
                    using (StreamReader lector = new StreamReader(respuesta.GetResponseStream())) lector.ReadToEnd();
                }
            }
            catch
            {
                /* si ya no responde, se le mata como último recurso */
            }
        }

        /// <summary>Se acabó la paciencia: se cierra a la fuerza.</summary>
        public void Matar()
        {
            try
            {
                if (proceso != null && !proceso.HasExited) proceso.Kill();
            }
            catch { /* ya no estaba */ }
        }

        public void Dispose()
        {
            try
            {
                if (proceso != null) proceso.Dispose();
            }
            catch { /* da igual al salir */ }
            proceso = null;
        }
    }

    /// <summary>
    /// Une argumentos en una sola línea, entre comillas cuando hace falta.
    ///
    /// Es el citado clásico de Windows: las barras invertidas que hay delante de
    /// una comilla se duplican, y la comilla de cierre necesita su barra doble.
    /// Así un dado de datos como `C:\Carpeta con espacios\datos` llega entero.
    /// (En .NET Framework no existe `ProcessStartInfo.ArgumentList`, hay que
    /// componer la línea de órdenes a mano.)
    /// </summary>
    internal static class Argumentos
    {
        public static string Unir(List<string> argumentos)
        {
            StringBuilder texto = new StringBuilder();
            for (int i = 0; i < argumentos.Count; i++)
            {
                if (i > 0) texto.Append(' ');
                texto.Append(Citar(argumentos[i]));
            }
            return texto.ToString();
        }

        private static string Citar(string argumento)
        {
            if (string.IsNullOrEmpty(argumento)) return "\"\"";
            bool necesita = argumento.IndexOf(' ') >= 0 || argumento.IndexOf('\t') >= 0 || argumento.IndexOf('"') >= 0;
            if (!necesita) return argumento;

            StringBuilder texto = new StringBuilder();
            texto.Append('"');
            int barras = 0;
            for (int i = 0; i < argumento.Length; i++)
            {
                char letra = argumento[i];
                if (letra == '\\')
                {
                    barras++;
                    continue;
                }
                if (letra == '"')
                {
                    texto.Append('\\', barras * 2 + 1);
                    texto.Append('"');
                    barras = 0;
                    continue;
                }
                if (barras > 0)
                {
                    texto.Append('\\', barras);
                    barras = 0;
                }
                texto.Append(letra);
            }
            if (barras > 0) texto.Append('\\', barras * 2);   /* cierra la cita */
            texto.Append('"');
            return texto.ToString();
        }
    }
}
