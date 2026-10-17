using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Windows.Forms;

namespace Nebula.Ventana
{
    /// <summary>
    /// El núcleo: `Nebula-nucleo.exe`.
    ///
    /// Es el motor de la biblioteca (el programa de siempre, con Node dentro):
    /// escanea carpetas, guarda los datos, descarga las fichas y sirve la API que
    /// esta ventana consume. La ventana solo lo arranca, espera a que responda y,
    /// al cerrarse, se lo lleva consigo.
    /// </summary>
    internal sealed class Nucleo
    {
        private const string NombreNucleo = "Nebula-nucleo.exe";

        private Process proceso;
        private bool externo;

        /// <summary>¿Ya había un motor respondiendo en ese puerto? (otra ventana abierta)</summary>
        public bool Externo
        {
            get { return externo; }
        }

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

        /// <summary>Carpeta de datos del usuario (la misma que usa el motor).</summary>
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

        /// <summary>Arranca el motor (o se conecta al que ya estuviera abierto).</summary>
        public void Arrancar(string rutaNucleo, string[] argumentos, int puerto)
        {
            if (Saludable(puerto))
            {
                /* ya hay una ventana de Nébula abierta: se usa su motor y no se
                   arranca otro (dos motores se pisarían la biblioteca) */
                externo = true;
                Salida.Linea("ya habia un motor respondiendo en el puerto " + puerto + ": se usa ese");
                return;
            }

            List<string> propios = ArgumentosDelMotor(argumentos, puerto, true);
            ProcessStartInfo inicio = new ProcessStartInfo(rutaNucleo);
            inicio.Arguments = Argumentos.Unir(propios);
            inicio.UseShellExecute = false;
            inicio.CreateNoWindow = true;
            inicio.WindowStyle = ProcessWindowStyle.Hidden;
            /* no se arranca dentro de la carpeta del programa: al desinstalar,
               Windows no deja borrar la carpeta de trabajo de un proceso */
            inicio.WorkingDirectory = Path.GetTempPath();

            proceso = Process.Start(inicio);
            if (proceso == null) throw new InvalidOperationException("no se pudo arrancar " + NombreNucleo);
            Salida.Linea("motor arrancado (proceso " + proceso.Id + ")");
        }

        /// <summary>Argumentos para el motor: los mismos, sin los de la ventana.</summary>
        private static List<string> ArgumentosDelMotor(string[] argumentos, int puerto, bool anadirPadre)
        {
            List<string> propios = new List<string>();
            bool tienePuerto = false;
            for (int i = 0; i < argumentos.Length; i++)
            {
                string actual = argumentos[i];
                if (actual == "--open" || actual == "--no-open" || actual == "--browser" ||
                    actual == "--navegador" || actual == "--padre" || actual == "--keep-alive")
                {
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
            if (anadirPadre)
            {
                propios.Add("--padre");
                propios.Add(Process.GetCurrentProcess().Id.ToString());
            }
            return propios;
        }

        /// <summary>Arranca el motor dejándole la ventana a él (cuando se pide el navegador).</summary>
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
            inicio.WorkingDirectory = Path.GetTempPath();
            Process hijo = Process.Start(inicio);
            hijo.WaitForExit();
            return hijo.ExitCode;
        }

        /// <summary>Ejecuta el motor tal cual y devuelve su código (instalar, desinstalar…).</summary>
        public static int EjecutarYEsperar(string rutaNucleo, string[] argumentos)
        {
            ProcessStartInfo inicio = new ProcessStartInfo(rutaNucleo);
            inicio.Arguments = Argumentos.Unir(new List<string>(argumentos));
            inicio.UseShellExecute = false;
            inicio.CreateNoWindow = true;
            /* fuera de la carpeta del programa: así la desinstalación puede
               borrarla entera cuando este proceso termine */
            inicio.WorkingDirectory = Path.GetTempPath();
            Process hijo = Process.Start(inicio);
            hijo.WaitForExit();
            return hijo.ExitCode;
        }

        /// <summary>¿El motor ya responde?</summary>
        public static bool Saludable(int puerto)
        {
            return Consultar(puerto, "/api/health").IndexOf("\"ok\":true", StringComparison.Ordinal) >= 0;
        }

        /// <summary>Petición corta al motor; devuelve el cuerpo o vacío si no contesta.</summary>
        private static string Consultar(int puerto, string ruta)
        {
            try
            {
                HttpWebRequest peticion = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + puerto + ruta);
                peticion.Timeout = 1500;
                peticion.ReadWriteTimeout = 1500;
                peticion.Method = "GET";
                using (WebResponse respuesta = peticion.GetResponse())
                using (StreamReader lector = new StreamReader(respuesta.GetResponseStream()))
                {
                    return lector.ReadToEnd();
                }
            }
            catch
            {
                return string.Empty;
            }
        }

        /// <summary>¿Sigue vivo el proceso del motor?</summary>
        public bool Vivo
        {
            get
            {
                if (externo) return true;
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

        /// <summary>Espera a que el motor termine (modo sin ventana propia).</summary>
        public int Esperar()
        {
            if (proceso == null) return 0;
            proceso.WaitForExit();
            return proceso.ExitCode;
        }

        /// <summary>
        /// Pide al motor que se cierre y espera un momento. Si hay un juego en
        /// marcha el motor responde que sigue pendiente y se queda contando el
        /// tiempo: en ese caso se le deja terminar solo (la ventana ya se cerró).
        /// Si el motor lo arrancó otro (otra ventana), no se toca.
        /// </summary>
        public void Cerrar(int puerto, bool mantener, int esperaMs)
        {
            if (externo) return;
            if (proceso == null) return;
            if (mantener)
            {
                Salida.Linea("se deja el motor en marcha (--keep-alive)");
                return;
            }
            PedirCierre(puerto);
            try
            {
                if (!proceso.WaitForExit(esperaMs))
                {
                    Salida.Linea("el motor no termino a tiempo (¿hay un juego en marcha?): se le deja terminar solo");
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
