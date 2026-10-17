using System;
using System.IO;
using System.Text;

namespace Nebula.Ventana
{
    /// <summary>
    /// Salida de texto de un programa que no tiene consola.
    ///
    /// Nébula es un programa de ventana, así que no hay ninguna ventana negra
    /// donde contar lo que pasa. Lo que el programa tenga que decir va a dos
    /// sitios:
    ///   · el archivo `Nebula-ventana.log`, junto a los datos del usuario, que es
    ///     lo que hay que mirar (o pedir) cuando algo no funciona;
    ///   · la salida estándar heredada, SOLO si existe. Al abrirlo desde una
    ///     terminal (`Nebula.exe --version`) sí hay salida, y ahí es donde hay que
    ///     responder; al abrirlo con doble clic no hay ninguna y no pasa nada.
    /// </summary>
    internal static class Salida
    {
        private static readonly object Candado = new object();
        private static string ruta;

        /// <summary>Prepara el archivo de registro dentro de la carpeta de datos.</summary>
        public static void Preparar(string carpetaDatos)
        {
            try
            {
                Directory.CreateDirectory(carpetaDatos);
                ruta = Path.Combine(carpetaDatos, "Nebula-ventana.log");
                if (File.Exists(ruta) && new FileInfo(ruta).Length > 512 * 1024) File.WriteAllText(ruta, string.Empty);
                Linea("--- ventana de Nébula abierta " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " ---");
            }
            catch
            {
                ruta = null;
            }
        }

        /// <summary>Ruta del archivo de registro (puede ser null si no se pudo usar).</summary>
        public static string Ruta
        {
            get { return ruta; }
        }

        /// <summary>Escribe una línea en el registro y, si hay, en la salida heredada.</summary>
        public static void Linea(string texto)
        {
            if (texto == null) return;
            lock (Candado)
            {
                EscribirEstandar(texto);
                EscribirArchivo(texto);
            }
        }

        /// <summary>Para los mensajes de error: además de anotarlo, lo saca por pantalla.</summary>
        public static void Error(string texto)
        {
            Linea("ERROR: " + texto);
        }

        private static void EscribirEstandar(string texto)
        {
            try
            {
                /* Sin `using`: no hay que cerrar un manejador que no es nuestro. */
                Stream salida = Console.OpenStandardOutput();
                if (salida == null) return;
                StreamWriter escritor = new StreamWriter(salida, new UTF8Encoding(false));
                escritor.WriteLine(texto);
                escritor.Flush();
            }
            catch
            {
                /* no hay salida estándar (doble clic): no es ningún problema */
            }
        }

        private static void EscribirArchivo(string texto)
        {
            if (ruta == null) return;
            try
            {
                File.AppendAllText(ruta, texto + Environment.NewLine, new UTF8Encoding(false));
            }
            catch
            {
                /* si no se puede escribir, el programa sigue funcionando igual */
            }
        }
    }
}
