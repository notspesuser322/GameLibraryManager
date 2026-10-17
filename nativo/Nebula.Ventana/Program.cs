using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Windows.Forms;

namespace Nebula.Ventana
{
    /// <summary>
    /// Punto de entrada de la ventana nativa de Nébula.
    ///
    /// Este programa hace tres cosas, según cómo se le llame:
    ///   1. Sin nada más (`Nebula.exe`) → arranca el núcleo y abre la ventana.
    ///   2. Con `--no-open`          → arranca el núcleo y se queda vigilando
    ///                                 (lo usa la integración continua).
    ///   3. Con `--version`, `--help`, `--uninstall`, `--install`… → responde o
    ///      pasa la orden al núcleo, que es quien conoce el registro de Windows.
    ///
    /// El programa es de ventana (no de consola): nunca aparece la ventana negra,
    /// ni siquiera un parpadeo. Lo que haga falta contar va al registro en archivo.
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] argumentos)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Opciones opciones = Opciones.Leer(argumentos);
            string carpetaDatos = Nucleo.CarpetaDatos(opciones.CarpetaDatos);
            Salida.Preparar(carpetaDatos);

            if (opciones.Version)
            {
                Salida.Linea("nebula " + VersionTexto());
                return 0;
            }
            if (opciones.Ayuda)
            {
                Salida.Linea(Ayuda());
                return 0;
            }

            string nucleoRuta = Nucleo.Buscar();
            if (nucleoRuta == null)
            {
                Salida.Error("no se encuentra el nucleo (Nebula-nucleo.exe) junto al programa");
                Aviso.Mostrar("Nébula no puede arrancar",
                    "No se encuentra Nebula-nucleo.exe en la misma carpeta que el programa.\n\n" +
                    "Vuelve a instalarlo o descomprime el ZIP entero (los dos archivos van juntos).");
                return 2;
            }
            Salida.Linea("nucleo: " + nucleoRuta + " · version " + VersionTexto());

            /* instalar o desinstalar: lo hace el núcleo, que es quien escribe el registro */
            if (opciones.PideInstalacion)
            {
                return Nucleo.EjecutarYEsperar(nucleoRuta, argumentos);
            }

            bool quiereVentana = opciones.AbrirVentana;
            bool puedeDibujar = quiereVentana && !opciones.Navegador && Nucleo.WebView2Disponible();
            if (quiereVentana && !puedeDibujar)
            {
                Salida.Linea(opciones.Navegador
                    ? "se abre en el navegador (--browser)"
                    : "no hay WebView2 en este equipo: se abre con la ventana de siempre");
                return Nucleo.Delegar(nucleoRuta, argumentos);
            }

            Nucleo nucleo = new Nucleo();
            try
            {
                nucleo.Arrancar(nucleoRuta, argumentos, opciones.Puerto);
                Salida.Linea("nucleo arrancado en el puerto " + opciones.Puerto);
            }
            catch (Exception error)
            {
                Salida.Error("no se pudo arrancar el nucleo: " + error.Message);
                Aviso.Mostrar("Nébula no puede arrancar", "No se pudo iniciar el motor del programa:\n\n" + error.Message);
                return 3;
            }

            if (!puedeDibujar)
            {
                /* --no-open: no hay ventana, pero el núcleo tiene que seguir vivo y
                   apagarse cuando el núcleo termine (o cuando se cierre este proceso) */
                int codigo = nucleo.Esperar();
                nucleo.Dispose();
                return codigo;
            }

            try
            {
                using (Ventana ventana = new Ventana(opciones.Puerto, nucleo, opciones.KeepAlive, carpetaDatos))
                {
                    Application.Run(ventana);
                }
            }
            finally
            {
                nucleo.Cerrar(opciones.Puerto, opciones.KeepAlive, 8000);
                nucleo.Dispose();
            }
            return 0;
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
                   "Los datos y el registro (Nebula.log) estan en %APPDATA%\\Nebula.";
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

        /// <summary>Instalar, reinstalar o desinstalar: lo hace el núcleo.</summary>
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
                    case "--host":
                        if (actual == "--host") Siguiente(argumentos, ref i);
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
            /* NEBULA_PORT, igual que en el núcleo */
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
