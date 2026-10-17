using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nebula.Ventana
{
    /// <summary>
    /// La biblioteca: todas las carátulas en una rejilla, con búsqueda y orden.
    ///
    /// Doble clic en una tarjeta abre la ficha del juego. Las tarjetas son
    /// controles nativos: no hay ninguna página web de por medio.
    /// </summary>
    internal sealed class VistaBiblioteca : UserControl
    {
        private readonly Api api;
        private readonly Portadas portadas;
        private readonly FlowLayoutPanel rejilla;
        private readonly TextBox busqueda;
        private readonly ComboBox orden;
        private readonly Label resumen;
        private readonly Label vacio;
        private readonly Timer espera;
        private List<Juego> juegos = new List<Juego>();
        private readonly List<EstadoJuego> estados = new List<EstadoJuego>();
        private string filtro = string.Empty;

        public event Action<Juego> AbrirJuego;

        public event Action<string> Aviso;

        public VistaBiblioteca(Api api, Portadas portadas)
        {
            this.api = api;
            this.portadas = portadas;
            Tema.Aplicar(this);
            Dock = DockStyle.Fill;

            /* barra de herramientas */
            Panel barra = new Panel();
            barra.Dock = DockStyle.Top;
            barra.Height = 54;
            barra.Padding = new Padding(18, 10, 18, 6);
            barra.BackColor = Tema.Fondo;

            Label etiquetaBuscar = Tema.Etiqueta("Buscar", Tema.Pequena, Tema.Suave);
            etiquetaBuscar.Location = new Point(18, 19);

            busqueda = new TextBox();
            busqueda.Width = 300;
            busqueda.Font = Tema.Normal;
            busqueda.BackColor = Tema.PanelClaro;
            busqueda.ForeColor = Tema.Texto;
            busqueda.BorderStyle = BorderStyle.FixedSingle;
            busqueda.Location = new Point(70, 16);
            busqueda.TextChanged += CambioBusqueda;

            orden = new ComboBox();
            orden.DropDownStyle = ComboBoxStyle.DropDownList;
            orden.Width = 190;
            orden.Font = Tema.Normal;
            orden.BackColor = Tema.PanelClaro;
            orden.ForeColor = Tema.Texto;
            orden.FlatStyle = FlatStyle.Flat;
            orden.Location = new Point(392, 16);
            orden.Items.AddRange(new object[] { "Nombre (A-Z)", "Más horas jugadas", "Última vez jugado" });
            orden.SelectedIndex = 0;
            orden.SelectedIndexChanged += (s, e) => PintarJuegos();

            resumen = Tema.Etiqueta(string.Empty, Tema.Pequena, Tema.Suave);
            resumen.Location = new Point(600, 20);

            barra.Controls.Add(etiquetaBuscar);
            barra.Controls.Add(busqueda);
            barra.Controls.Add(orden);
            barra.Controls.Add(resumen);

            /* rejilla de tarjetas */
            rejilla = new FlowLayoutPanel();
            rejilla.Dock = DockStyle.Fill;
            rejilla.AutoScroll = true;
            rejilla.BackColor = Tema.Fondo;
            rejilla.Padding = new Padding(12, 6, 12, 18);
            rejilla.WrapContents = true;
            rejilla.FlowDirection = FlowDirection.LeftToRight;

            vacio = Tema.Etiqueta(
                "Todavía no hay juegos.\n\nAgrega una carpeta en «Buscar juegos» y Nébula hará el resto:\n" +
                "detecta los juegos, descarga su ficha y su carátula.", Tema.Subtitulo, Tema.Suave);
            vacio.Dock = DockStyle.Fill;
            vacio.AutoSize = false;
            vacio.TextAlign = ContentAlignment.MiddleCenter;
            vacio.Visible = false;

            Controls.Add(rejilla);
            Controls.Add(vacio);
            Controls.Add(barra);

            espera = new Timer();
            espera.Interval = 220;
            espera.Tick += (s, e) =>
            {
                espera.Stop();
                filtro = busqueda.Text.Trim();
                PintarJuegos();
            };
        }

        private void CambioBusqueda(object remitente, EventArgs e)
        {
            espera.Stop();
            espera.Start();
        }

        /// <summary>Vuelve a pedir la biblioteca al motor y repinta.</summary>
        public async Task RecargarAsync(bool renovarCaratulas = false)
        {
            if (renovarCaratulas) portadas.Renovar();
            JToken estado;
            try
            {
                estado = await api.EstadoAsync();
            }
            catch (Exception error)
            {
                Avisar("No se pudo leer la biblioteca: " + error.Message);
                return;
            }
            if (estado == null) return;

            estados.Clear();
            estados.AddRange(EstadoJuego.Desde(estado["statuses"]));

            List<Juego> leidos = new List<Juego>();
            JArray arreglo = estado["games"] as JArray;
            if (arreglo != null)
            {
                foreach (JToken token in arreglo)
                {
                    Juego juego = Juego.Desde(token);
                    foreach (EstadoJuego posible in estados)
                    {
                        if (posible.Id == juego.Estado)
                        {
                            juego.EstadoEtiqueta = posible.Etiqueta;
                            juego.EstadoColor = posible.Color;
                            break;
                        }
                    }
                    leidos.Add(juego);
                }
            }
            juegos = leidos;
            PintarJuegos();
            int enMarcha = juegos.FindAll(j => j.EnMarcha).Count;
            Avisar(juegos.Count + (juegos.Count == 1 ? " juego" : " juegos") +
                   (enMarcha > 0 ? " · " + enMarcha + " en marcha" : string.Empty));
        }

        /// <summary>Repinta con los juegos que ya se tienen en memoria (sin pedir nada).</summary>
        private void PintarJuegos()
        {
            List<Juego> visibles = new List<Juego>();
            foreach (Juego juego in juegos)
            {
                if (filtro.Length == 0 || juego.Nombre.IndexOf(filtro, StringComparison.CurrentCultureIgnoreCase) >= 0)
                {
                    visibles.Add(juego);
                }
            }
            visibles.Sort(Comparar);
            if (orden.SelectedIndex == 1) visibles.Reverse();   /* más horas primero */

            rejilla.SuspendLayout();
            /* se copia la lista antes de soltar los controles: no se puede recorrer
               una colección mientras se vacía */
            List<Control> viejas = new List<Control>();
            foreach (Control viejo in rejilla.Controls) viejas.Add(viejo);
            rejilla.Controls.Clear();
            foreach (Control viejo in viejas) viejo.Dispose();

            foreach (Juego juego in visibles)
            {
                TarjetaJuego tarjeta = new TarjetaJuego(juego, portadas);
                tarjeta.Abrir += (s, e) =>
                {
                    if (AbrirJuego != null) AbrirJuego(((TarjetaJuego)s).Juego);
                };
                rejilla.Controls.Add(tarjeta);
                tarjeta.CargarPortada();
            }
            rejilla.ResumeLayout();

            bool hay = visibles.Count > 0;
            rejilla.Visible = hay;
            vacio.Visible = !hay;
            resumen.Text = juegos.Count == 0
                ? string.Empty
                : (visibles.Count == juegos.Count ? juegos.Count + " en total" : visibles.Count + " de " + juegos.Count);
        }

        private int Comparar(Juego a, Juego b)
        {
            if (orden.SelectedIndex == 1)
            {
                /* por horas; después se invierte para dejar las más jugadas arriba */
                if (a.Segundos == b.Segundos) return string.Compare(a.Nombre, b.Nombre, StringComparison.CurrentCultureIgnoreCase);
                return a.Segundos < b.Segundos ? -1 : 1;
            }
            if (orden.SelectedIndex == 2)
            {
                /* la última vez jugado: lo más reciente primero */
                return string.Compare(b.UltimaVez, a.UltimaVez, StringComparison.Ordinal);
            }
            return string.Compare(a.Nombre, b.Nombre, StringComparison.CurrentCultureIgnoreCase);
        }

        /// <summary>Actualiza en el sitio los juegos en marcha (sin repintar todo).</summary>
        public void MarcarEnMarcha(HashSet<string> ids)
        {
            foreach (Control control in rejilla.Controls)
            {
                TarjetaJuego tarjeta = control as TarjetaJuego;
                if (tarjeta == null) continue;
                bool marcha = ids.Contains(tarjeta.Juego.Id);
                if (marcha == tarjeta.Juego.EnMarcha) continue;
                tarjeta.Juego.EnMarcha = marcha;
                tarjeta.Invalidate();
            }
        }

        public void EnfocarBusqueda()
        {
            busqueda.Focus();
            busqueda.SelectAll();
        }

        private void Avisar(string texto)
        {
            if (Aviso != null) Aviso(texto);
        }
    }
}
