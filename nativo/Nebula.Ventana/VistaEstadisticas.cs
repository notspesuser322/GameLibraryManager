using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>Estadísticas de la biblioteca, con controles nativos.</summary>
    internal sealed class VistaEstadisticas : UserControl
    {
        private readonly Api api;
        private readonly Label valorJuegos;
        private readonly Label valorHoras;
        private readonly Label valorSesiones;
        private readonly Label valorFavoritos;
        private readonly ListView mejores;
        private readonly ListView porEstado;
        private readonly Label generado;

        public event Action<string> Aviso;

        public VistaEstadisticas(Api api)
        {
            this.api = api;
            Tema.Aplicar(this);
            Dock = DockStyle.Fill;

            PanelRedondeado cifras = new PanelRedondeado();
            cifras.Dock = DockStyle.Top;
            cifras.Height = 116;
            cifras.Padding = new Padding(16);

            valorJuegos = Cifra(cifras, 16, 18, "Juegos");
            valorHoras = Cifra(cifras, 200, 18, "Horas jugadas");
            valorSesiones = Cifra(cifras, 384, 18, "Sesiones");
            valorFavoritos = Cifra(cifras, 568, 18, "Favoritos");

            PanelRedondeado arriba = new PanelRedondeado();
            arriba.Dock = DockStyle.Fill;
            arriba.Padding = new Padding(16);

            Label tituloMejores = Tema.Etiqueta("Los más jugados", Tema.Subtitulo);
            tituloMejores.Location = new Point(16, 12);
            mejores = new ListView();
            mejores.View = View.Details;
            mejores.FullRowSelect = true;
            mejores.Columns.Add("Juego", 250);
            mejores.Columns.Add("Horas", 80);
            mejores.Columns.Add("Sesiones", 70);
            mejores.Location = new Point(16, 44);
            mejores.Size = new Size(400, 260);
            mejores.BackColor = Tema.PanelClaro;
            mejores.ForeColor = Tema.Texto;
            mejores.BorderStyle = BorderStyle.FixedSingle;
            mejores.Font = Tema.Pequena;

            Label tituloEstados = Tema.Etiqueta("Por estado", Tema.Subtitulo);
            tituloEstados.Location = new Point(432, 12);
            porEstado = new ListView();
            porEstado.View = View.Details;
            porEstado.FullRowSelect = true;
            porEstado.Columns.Add("Estado", 170);
            porEstado.Columns.Add("Juegos", 70);
            porEstado.Location = new Point(432, 44);
            porEstado.Size = new Size(256, 200);
            porEstado.BackColor = Tema.PanelClaro;
            porEstado.ForeColor = Tema.Texto;
            porEstado.BorderStyle = BorderStyle.FixedSingle;
            porEstado.Font = Tema.Pequena;

            generado = Tema.Etiqueta(string.Empty, Tema.Pequena, Tema.Suave);
            generado.Location = new Point(432, 254);

            arriba.Controls.Add(tituloMejores);
            arriba.Controls.Add(mejores);
            arriba.Controls.Add(tituloEstados);
            arriba.Controls.Add(porEstado);
            arriba.Controls.Add(generado);

            Panel hueco = new Panel();
            hueco.Dock = DockStyle.Top;
            hueco.Height = 12;

            Controls.Add(arriba);
            Controls.Add(hueco);
            Controls.Add(cifras);

            /* las dos tablas se reparten el ancho disponible */
            arriba.Resize += (s, e) =>
            {
                int ancho = arriba.ClientSize.Width - 32;
                int izquierda = Math.Max(260, (int)(ancho * 0.58));
                mejores.Width = izquierda;
                porEstado.Left = 16 + izquierda + 16;
                porEstado.Width = Math.Max(200, ancho - izquierda - 16);
                generado.Left = porEstado.Left;
            };
        }

        private static Label Cifra(Control padre, int x, int y, string titulo)
        {
            Label valor = Tema.Etiqueta("—", Tema.Cifra, Tema.Acento);
            valor.Location = new Point(x, y);
            Label etiqueta = Tema.Etiqueta(titulo, Tema.Pequena, Tema.Suave);
            etiqueta.Location = new Point(x + 2, y + 40);
            padre.Controls.Add(valor);
            padre.Controls.Add(etiqueta);
            return valor;
        }

        public async Task RecargarAsync()
        {
            JToken estado;
            try
            {
                estado = await api.EstadoAsync();
            }
            catch (Exception error)
            {
                Avisar("No se pudieron leer las estadísticas: " + error.Message);
                return;
            }
            if (estado == null) return;
            /* el motor no manda las sesiones en «top»: se buscan en la lista de juegos */
            Dictionary<string, long> sesionesPorJuego = new Dictionary<string, long>();
            JArray juegos = estado["games"] as JArray;
            if (juegos != null)
            {
                foreach (JToken juego in juegos)
                {
                    sesionesPorJuego[Juego.Texto(juego, "id")] = Juego.Numero(juego, "sessionCount");
                }
            }

            JToken stats = estado["stats"];
            JToken totales = stats == null ? null : stats["totals"];
            valorJuegos.Text = ((long)Juego.Numero(totales, "games")).ToString();
            valorHoras.Text = Tema.Duracion(Juego.Numero(totales, "seconds"));
            valorSesiones.Text = ((long)Juego.Numero(totales, "sessions")).ToString();
            valorFavoritos.Text = ((long)Juego.Numero(totales, "favorites")).ToString();

            mejores.BeginUpdate();
            mejores.Items.Clear();
            JArray top = stats == null ? null : stats["top"] as JArray;
            if (top != null)
            {
                foreach (JToken token in top)
                {
                    ListViewItem fila = new ListViewItem(Juego.Texto(token, "name"));
                    fila.SubItems.Add(Tema.Duracion(Juego.Numero(token, "seconds")));
                    long sesiones;
                    if (!sesionesPorJuego.TryGetValue(Juego.Texto(token, "id"), out sesiones)) sesiones = 0;
                    fila.SubItems.Add(sesiones.ToString());
                    mejores.Items.Add(fila);
                }
            }
            mejores.EndUpdate();

            porEstado.BeginUpdate();
            porEstado.Items.Clear();
            JToken porEstados = stats == null ? null : stats["byStatus"];
            JArray estados = estado["statuses"] as JArray;
            if (porEstados != null && estados != null)
            {
                foreach (JToken definicion in estados)
                {
                    string id = Juego.Texto(definicion, "id");
                    ListViewItem fila = new ListViewItem(Juego.Texto(definicion, "label", id));
                    fila.SubItems.Add(Juego.Numero(porEstados, id).ToString());
                    porEstado.Items.Add(fila);
                }
            }
            porEstado.EndUpdate();
            generado.Text = "Datos de la biblioteca actual.";
        }

        private void Avisar(string texto)
        {
            if (Aviso != null) Aviso(texto);
        }
    }
}
