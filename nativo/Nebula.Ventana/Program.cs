using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Windows.Forms;

namespace Nebula.Ventana
{
    /// <summary>
    /// Punto de entrada de Nébula.
    ///
    /// Este programa ES la aplicación: una ventana de Windows nativa (WinForms)
    /// que habla con el motor por la API local. Hace tres cosas, según cómo se le
    /// llame:
    ///   1. Sin nada más (`Nebula.exe`) → arranca el motor y abre la ventana.
    ///   2. Con `--no-open`          → arranca el motor y se queda vigilando
    ///                                 (lo usa la integración continua).
    ///   3. Con `--version`, `--help`, `--uninstall`, `--install`… → responde o
    ///      pasa la orden al motor, que es quien conoce el registro de Windows.
    ///
    /// Es un programa de ventana (no de consola): nunca aparece la ventana negra.
    /// Lo que haya que contar va al registro en archivo.
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] argumentos)
        {
            /* si lo llaman desde una terminal, contestar ahí (--version, --help) */
            Salida.Enganchar();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Opciones opciones = Opciones.Leer(argumentos);
            string carpetaDatos = Nucleo.CarpetaDatos(opciones.CarpetaDatos);

            /* responder a la terminal sin crear nada ni ensuciar la respuesta */
            if (opciones.Version)
            {
                Salida.Inmediata("nebula " + VersionTexto());
                return 0;
            }
            if (opciones.Ayuda)
            {
                Salida.Inmediata(Ayuda());
                return 0;
            }

            Salida.Preparar(carpetaDatos);

            string nucleoRuta = Nucleo.Buscar();
            if (nucleoRuta == null)
            {
                Salida.Error("no se encuentra el motor (Nebula-nucleo.exe) junto al programa");
                Aviso.Mostrar("Nébula no puede arrancar",
                    "No se encuentra Nebula-nucleo.exe en la misma carpeta que el programa.\n\n" +
                    "Vuelve a instalarlo o descomprime el ZIP entero (los dos archivos van juntos).");
                return 2;
            }
            Salida.Linea("motor: " + nucleoRuta + " · version " + VersionTexto());

            /* instalar o desinstalar: lo hace el motor, que es quien escribe el registro */
            if (opciones.PideInstalacion)
            {
                return Nucleo.EjecutarYEsperar(nucleoRuta, argumentos);
            }

            if (opciones.Navegador)
            {
                /* a petición expresa, se abre en el navegador de siempre */
                Salida.Linea("se abre en el navegador (--browser)");
                return Nucleo.Delegar(nucleoRuta, argumentos);
            }

            Nucleo nucleo = new Nucleo();
            try
            {
                nucleo.Arrancar(nucleoRuta, argumentos, opciones.Puerto);
            }
            catch (Exception error)
            {
                Salida.Error("no se pudo arrancar el motor: " + error.Message);
                Aviso.Mostrar("Nébula no puede arrancar", "No se pudo iniciar el motor del programa:\n\n" + error.Message);
                return 3;
            }

            if (opciones.NoAbrir)
            {
                /* sin ventana (integración continua o uso desde la terminal): el
                   proceso vive lo que viva el motor */
                int codigo = nucleo.Esperar();
                nucleo.Dispose();
                return codigo;
            }

            int salida = 0;
            try
            {
                using (Api api = new Api(opciones.Puerto))
                using (VentanaPrincipal ventana = new VentanaPrincipal(api, nucleo, opciones.Puerto, VersionTexto(), carpetaDatos))
                {
                    Application.Run(ventana);
                }
            }
            catch (Exception error)
            {
                Salida.Error("la ventana falló: " + error);
                Aviso.Mostrar("Nébula no puede abrirse", "La ventana del programa falló:\n\n" + error.Message +
                    "\n\nEn %APPDATA%\\Nebula\\Nebula-ventana.log está el detalle.");
                salida = 4;
            }
            finally
            {
                nucleo.Cerrar(opciones.Puerto, opciones.KeepAlive, 8000);
                nucleo.Dispose();
            }
            return salida;
        }

        /// <summary>
        /// Versión del programa, tomada del propio ejecutable.
        ///
        /// Se pregunta por tres caminos, del más exacto al más básico, porque de
        /// esta respuesta depende que `--version` diga la verdad: la versión
        /// informativa, la del ensamblado y, si las dos vinieran vacías, la que
        /// Windows guarda en los datos del archivo.
        /// </summary>
        public static string VersionTexto()
        {
            try
            {
                AssemblyInformationalVersionAttribute informativa =
                    Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>();
                if (informativa != null && EsVersionUtil(informativa.InformationalVersion)) return informativa.InformationalVersion;

                Version ensamblado = Assembly.GetExecutingAssembly().GetName().Version;
                if (ensamblado != null && ensamblado.Major > 0) return ensamblado.ToString(3);

                FileVersionInfo datos = FileVersionInfo.GetVersionInfo(Application.ExecutablePath);
                if (!string.IsNullOrEmpty(datos.ProductVersion) && EsVersionUtil(datos.ProductVersion)) return datos.ProductVersion;
                if (!string.IsNullOrEmpty(datos.FileVersion) && EsVersionUtil(datos.FileVersion)) return datos.FileVersion;
            }
            catch { /* se responde con lo que haya */ }
            return Application.ProductVersion;
        }

        private static bool EsVersionUtil(string texto)
        {
            if (string.IsNullOrEmpty(texto)) return false;
            return texto != "0.0.0" && !texto.StartsWith("0.0.0.");
        }

        private static string Ayuda()
        {
            return "Nébula " + VersionTexto() + " — ventana del programa\n\n" +
                   "Uso:\n" +
                   "  Nebula.exe                      abre la biblioteca en su ventana\n" +
                   "  Nebula.exe --port 4400          usa otro puerto\n" +
                   "  Nebula.exe --browser            abre en el navegador de siempre\n" +
                   "  Nebula.exe --keep-alive         deja el motor en marcha al cerrar la ventana\n" +
                   "  Nebula.exe --version            muestra la version y termina\n" +
                   "  Nebula.exe --uninstall          quita el programa del equipo\n\n" +
                   "Los datos y los registros (Nebula.log y Nebula-ventana.log) estan en %APPDATA%\\Nebula.";
        }
    }

    /// <summary>Los argumentos que entiende la ventana.</summary>
    internal sealed class Opciones
    {
        public int Puerto = ProgramaConstantes.PuertoPorDefecto;
        public string CarpetaDatos;
        public bool Version;
        public bool Ayuda;
        public bool Navegador;
        public bool KeepAlive;
        public bool NoAbrir;
        public bool Abrir;

        /// <summary>¿Hay que abrir la ventana? (sí, salvo con --no-open)</summary>
        public bool AbrirVentana
        {
            get { return !NoAbrir; }
        }

        /// <summary>Instalar, reinstalar o desinstalar: lo hace el motor.</summary>
        public bool PideInstalacion
        {
            get { return pideInstalacion; }
        }

        private bool pideInstalacion;

        public static Opciones Leer(string[] argumentos)
        {
            Opciones opciones = new Opciones();
            for (int i = 0; i < argumentos.Length; i++)
            {
                string actual = argumentos[i];
                switch (actual)
                {
                    case "--port":
                    case "-p":
                        opciones.Puerto = LeerPuerto(Siguiente(argumentos, ref i), opciones.Puerto);
                        break;
                    case "--data-dir":
                        opciones.CarpetaDatos = Siguiente(argumentos, ref i);
                        break;
                    case "--demo":
                        break;
                    case "--host":
                        Siguiente(argumentos, ref i);
                        break;
                    case "--open":
                        opciones.Abrir = true;
                        break;
                    case "--no-open":
                        opciones.NoAbrir = true;
                        break;
                    case "--browser":
                    case "--navegador":
                        opciones.Navegador = true;
                        break;
                    case "--keep-alive":
                        opciones.KeepAlive = true;
                        break;
                    case "--version":
                    case "-v":
                        opciones.Version = true;
                        break;
                    case "--help":
                    case "-h":
                        opciones.Ayuda = true;
                        break;
                    case "--uninstall":
                    case "--desinstalar":
                    case "--install":
                    case "--instalar":
                    case "--reinstall":
                    case "--reinstalar":
                        opciones.pideInstalacion = true;
                        break;
                    default:
                        break;
                }
            }
            /* NEBULA_PORT, igual que en el motor */
            string entorno = Environment.GetEnvironmentVariable("NEBULA_PORT");
            if (opciones.Puerto == ProgramaConstantes.PuertoPorDefecto && !string.IsNullOrEmpty(entorno))
            {
                opciones.Puerto = LeerPuerto(entorno, opciones.Puerto);
            }
            return opciones;
        }

        private static string Siguiente(string[] argumentos, ref int indice)
        {
            if (indice + 1 >= argumentos.Length) return null;
            indice++;
            return argumentos[indice];
        }

        private static int LeerPuerto(string texto, int porDefecto)
        {
            int numero;
            if (!string.IsNullOrEmpty(texto) && int.TryParse(texto, NumberStyles.Integer, CultureInfo.InvariantCulture, out numero) && numero > 0 && numero < 65536)
            {
                return numero;
            }
            return porDefecto;
        }
    }

    /// <summary>Constantes compartidas (una sola cifra para el puerto por defecto).</summary>
    internal static class ProgramaConstantes
    {
        public const int PuertoPorDefecto = 4337;
    }

    /// <summary>Cuadros de aviso del programa.</summary>
    internal static class Aviso
    {
        public static void Mostrar(string titulo, string texto)
        {
            try
            {
                MessageBox.Show(texto, titulo, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch { /* sin escritorio no hay diálogo posible */ }
        }
    }
}
