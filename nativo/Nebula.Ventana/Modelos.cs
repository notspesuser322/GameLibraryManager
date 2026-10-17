using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>Un juego, tal como lo cuenta el motor.</summary>
    internal sealed class Juego
    {
        public string Id = string.Empty;
        public string Nombre = string.Empty;
        public string Estado = "backlog";
        public string EstadoEtiqueta = "Pendiente";
        public string EstadoColor = "#7c9cff";
        public string Plataforma = "manual";
        public string PlataformaEtiqueta = "Manual";
        public string PlataformaColor = "#8d93a1";
        public string Descripcion = string.Empty;
        public string Notas = string.Empty;
        public string Carpeta = string.Empty;
        public string Ejecutable = string.Empty;
        public string Lanzamiento = string.Empty;
        public string Desarrolladores = string.Empty;
        public string UltimaVez = string.Empty;
        public long Segundos;
        public int Sesiones;
        public long PesoBytes;
        public bool EnMarcha;
        public bool Favorito;
        public bool Existe = true;
        public List<string> Generos = new List<string>();

        public string Horas
        {
            get { return Tema.Duracion(Segundos); }
        }

        public string GenerosTexto
        {
            get { return Generos.Count == 0 ? "—" : string.Join(", ", Generos.ToArray()); }
        }

        public static Juego Desde(JToken token)
        {
            Juego juego = new Juego();
            if (token == null) return juego;
            juego.Id = Texto(token, "id");
            juego.Nombre = Texto(token, "name", "(sin nombre)");
            juego.Estado = Texto(token, "status", "backlog");
            juego.EstadoEtiqueta = Texto(token, "statusLabel", juego.Estado);
            juego.EstadoColor = Texto(token, "statusColor", "#7c9cff");
            juego.Plataforma = Texto(token, "platform", "manual");
            juego.PlataformaEtiqueta = Texto(token, "platformLabel", juego.Plataforma);
            juego.PlataformaColor = Texto(token, "platformColor", "#8d93a1");
            juego.Descripcion = Texto(token, "description");
            juego.Notas = Texto(token, "notes");
            juego.Carpeta = Texto(token, "installDir");
            juego.Ejecutable = Texto(token, "executable");
            juego.Lanzamiento = Texto(token, "releaseDate");
            juego.Desarrolladores = Lista(token, "developers");
            juego.UltimaVez = Texto(token, "lastPlayed");
            juego.Segundos = Numero(token, "playtimeSeconds");
            juego.Sesiones = (int)Numero(token, "sessionCount");
            juego.PesoBytes = Numero(token, "sizeBytes");
            juego.EnMarcha = Booleano(token, "running");
            juego.Favorito = Booleano(token, "favorite");
            juego.Existe = token["pathExists"] == null || Booleano(token, "pathExists");
            juego.Generos = TextosDeLista(token, "genres");
            return juego;
        }

        /* los ayudantes toleran que el motor no mande un campo (versiones futuras) */

        internal static string Texto(JToken token, string clave, string porDefecto = "")
        {
            JToken valor = token == null ? null : token[clave];
            if (valor == null || valor.Type == JTokenType.Null) return porDefecto;
            return valor.ToString();
        }

        internal static long Numero(JToken token, string clave)
        {
            JToken valor = token == null ? null : token[clave];
            if (valor == null) return 0;
            long numero;
            if (long.TryParse(valor.ToString(), out numero)) return numero;
            double decimales;
            if (double.TryParse(valor.ToString(), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out decimales)) return (long)decimales;
            return 0;
        }

        internal static bool Booleano(JToken token, string clave, bool porDefecto = false)
        {
            JToken valor = token == null ? null : token[clave];
            if (valor == null) return porDefecto;
            if (valor.Type == JTokenType.Boolean) return valor.Value<bool>();
            string texto = valor.ToString();
            return texto.Equals("true", StringComparison.OrdinalIgnoreCase) || texto == "1";
        }

        internal static List<string> TextosDeLista(JToken token, string clave)
        {
            List<string> lista = new List<string>();
            JArray arreglo = token == null ? null : token[clave] as JArray;
            if (arreglo == null) return lista;
            foreach (JToken valor in arreglo)
            {
                if (valor != null && valor.Type != JTokenType.Null) lista.Add(valor.ToString());
            }
            return lista;
        }

        internal static string Lista(JToken token, string clave)
        {
            List<string> valores = TextosDeLista(token, clave);
            return valores.Count == 0 ? "—" : string.Join(", ", valores.ToArray());
        }
    }

    /// <summary>Un estado del juego (los define el motor; aquí solo se usan).</summary>
    internal sealed class EstadoJuego
    {
        public string Id = string.Empty;
        public string Etiqueta = string.Empty;
        public string Color = "#7c9cff";

        public static List<EstadoJuego> Desde(JToken token)
        {
            List<EstadoJuego> estados = new List<EstadoJuego>();
            JArray arreglo = token as JArray;
            if (arreglo == null) return estados;
            foreach (JToken valor in arreglo)
            {
                EstadoJuego estado = new EstadoJuego();
                estado.Id = Juego.Texto(valor, "id");
                estado.Etiqueta = Juego.Texto(valor, "label", estado.Id);
                estado.Color = Juego.Texto(valor, "color", "#7c9cff");
                if (estado.Id.Length > 0) estados.Add(estado);
            }
            return estados;
        }
    }

    /// <summary>Una carpeta vigilada.</summary>
    internal sealed class CarpetaVigilada
    {
        public string Id = string.Empty;
        public string Ruta = string.Empty;
        public string Etiqueta = string.Empty;
        public string Tipo = "collection";
        public bool Recursiva;

        public string TipoTexto
        {
            get
            {
                if (Tipo == "rom") return "ROMs";
                if (Tipo == "single") return "Un solo juego";
                return "Varios juegos";
            }
        }

        public static List<CarpetaVigilada> Desde(JToken token)
        {
            List<CarpetaVigilada> lista = new List<CarpetaVigilada>();
            JArray arreglo = token as JArray;
            if (arreglo == null) return lista;
            foreach (JToken valor in arreglo)
            {
                CarpetaVigilada carpeta = new CarpetaVigilada();
                carpeta.Id = Juego.Texto(valor, "id");
                carpeta.Ruta = Juego.Texto(valor, "path");
                carpeta.Etiqueta = Juego.Texto(valor, "label", carpeta.Ruta);
                carpeta.Tipo = Juego.Texto(valor, "kind", "collection");
                carpeta.Recursiva = Juego.Booleano(valor, "recursive");
                lista.Add(carpeta);
            }
            return lista;
        }
    }
}
