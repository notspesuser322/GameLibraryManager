using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Nebula.Ventana
{
    /// <summary>
    /// Tarjeta de un juego: carátula, título, estado y horas. Todo dibujado por
    /// el programa (nada de HTML): es un control de Windows como cualquier otro,
    /// con su doble clic, su selección y su resaltado al pasar el ratón.
    /// </summary>
    internal sealed class TarjetaJuego : Control
    {
        private readonly Portadas portadas;
        private Image imagen;
        private bool ratonEncima;
        private bool seleccionada;

        public Juego Juego { get; private set; }

        public event EventHandler Abrir;

        public TarjetaJuego(Juego juego, Portadas portadas)
        {
            Juego = juego;
            this.portadas = portadas;
            Size = new Size(196, 306);
            Margin = new Padding(10);
            Cursor = Cursors.Hand;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            TabStop = true;
        }

        /// <summary>Pide la carátula al motor y repinta cuando llega.</summary>
        public async void CargarPortada()
        {
            try
            {
                Image cargada = await portadas.ObtenerAsync(Juego.Id).ConfigureAwait(true);
                if (IsDisposed) return;
                imagen = cargada;
                Invalidate();
            }
            catch
            {
                /* sin carátula: se queda el hueco */
            }
        }

        /// <summary>Cambia los datos (por ejemplo, cuando el juego se pone en marcha).</summary>
        public void Actualizar(Juego juego)
        {
            Juego = juego;
            Invalidate();
        }

        public void Seleccionar(bool valor)
        {
            seleccionada = valor;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Rectangle caja = new Rectangle(0, 0, Width - 1, Height - 1);
            Color fondo = ratonEncima ? Tema.PanelClaro : Tema.Panel;
            Color borde = seleccionada ? Tema.Acento : Tema.Borde;
            Tema.Rellenar(g, caja, 12, fondo, borde);

            Rectangle zonaPortada = new Rectangle(12, 12, Width - 24, Height - 92);
            Tema.Rellenar(g, zonaPortada, 8, Color.FromArgb(0x0F, 0x12, 0x1D));

            if (imagen != null)
            {
                /* la carátula se recorta con la misma forma redondeada del hueco */
                GraphicsState estado = g.Save();
                using (GraphicsPath recorte = Tema.Redondeado(zonaPortada, 8)) g.SetClip(recorte);
                Tema.DibujarEncajada(g, imagen, zonaPortada);
                g.Restore(estado);
            }
            else
            {
                string iniciales = Iniciales(Juego.Nombre);
                using (Font fuente = new Font("Segoe UI Semibold", 30F, FontStyle.Bold))
                {
                    TextRenderer.DrawText(g, iniciales, fuente, zonaPortada, Color.FromArgb(0x35, 0x3D, 0x5C),
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
                }
            }

            /* etiqueta de «en marcha» sobre la carátula */
            if (Juego.EnMarcha)
            {
                Rectangle vivo = new Rectangle(zonaPortada.X + 8, zonaPortada.Y + 8, 84, 22);
                Tema.Rellenar(g, vivo, 11, Tema.Verde);
                TextRenderer.DrawText(g, "EN MARCHA", Tema.Pequena, vivo, Color.FromArgb(0x06, 0x2A, 0x1B),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            }

            /* título (dos líneas como mucho) */
            Rectangle zonaTitulo = new Rectangle(12, Height - 76, Width - 24, 38);
            TextRenderer.DrawText(g, Juego.Nombre, Tema.Negrita, zonaTitulo, Tema.Texto,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

            /* píldora del estado + horas */
            Color colorEstado = Tema.DeHex(Juego.EstadoColor, Tema.Acento);
            string etiqueta = Juego.EstadoEtiqueta;
            Size medida = TextRenderer.MeasureText(etiqueta, Tema.Pequena);
            Rectangle pastilla = new Rectangle(12, Height - 32, Math.Min(Width - 24, medida.Width + 18), 20);
            Tema.Rellenar(g, pastilla, 10, Color.FromArgb(40, colorEstado.R, colorEstado.G, colorEstado.B));
            TextRenderer.DrawText(g, etiqueta, Tema.Pequena, pastilla, colorEstado,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);

            Rectangle horas = new Rectangle(pastilla.Right + 6, Height - 32, Width - pastilla.Right - 18, 20);
            TextRenderer.DrawText(g, Juego.Horas, Tema.Pequena, horas, Tema.Suave,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
        }

        private static string Iniciales(string nombre)
        {
            if (string.IsNullOrEmpty(nombre)) return "?";
            string[] partes = nombre.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (partes.Length == 1) return partes[0].Substring(0, 1).ToUpperInvariant();
            return (partes[0].Substring(0, 1) + partes[1].Substring(0, 1)).ToUpperInvariant();
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            ratonEncima = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            ratonEncima = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            Seleccionar(true);
            base.OnMouseDown(e);
        }

        protected override void OnMouseDoubleClick(MouseEventArgs e)
        {
            if (Abrir != null) Abrir(this, EventArgs.Empty);
            base.OnMouseDoubleClick(e);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter && Abrir != null) Abrir(this, EventArgs.Empty);
            base.OnKeyDown(e);
        }

        protected override void OnGotFocus(EventArgs e)
        {
            Seleccionar(true);
            base.OnGotFocus(e);
        }
    }

    /// <summary>Botón de la barra lateral: alto, alineado a la izquierda y con estado.</summary>
    internal sealed class BotonLateral : Button
    {
        private bool activo;

        public BotonLateral(string texto)
        {
            Text = texto;
            AutoSize = false;
            Height = 42;
            Dock = DockStyle.Top;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            TextAlign = ContentAlignment.MiddleLeft;
            Padding = new Padding(16, 0, 0, 0);
            Font = Tema.Negrita;
            ForeColor = Tema.Suave;
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
            UseVisualStyleBackColor = false;
            Margin = new Padding(0, 2, 0, 2);
        }

        public bool Activo
        {
            get { return activo; }
            set
            {
                activo = value;
                BackColor = activo ? Tema.AcentoOscuro : Color.Transparent;
                ForeColor = activo ? Color.White : Tema.Suave;
                Invalidate();
            }
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            if (!activo) BackColor = Tema.PanelClaro;
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            if (!activo) BackColor = Color.Transparent;
            base.OnMouseLeave(e);
        }
    }

    /// <summary>
    /// Panel con esquinas redondeadas y borde, para agrupar cosas.
    ///
    /// La forma se recorta con una región (en vez de pintar por encima) para que
    /// las etiquetas con fondo transparente de dentro se mezclen bien con el panel
    /// y no dejen recuadros.
    /// </summary>
    internal sealed class PanelRedondeado : Panel
    {
        public PanelRedondeado()
        {
            BackColor = Tema.Panel;
            Padding = new Padding(16);
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (Width > 8 && Height > 8)
            {
                using (GraphicsPath camino = Tema.Redondeado(new Rectangle(0, 0, Width, Height), 12))
                {
                    Region = new Region(camino);
                }
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen lapiz = new Pen(Tema.Borde, 1f))
            using (GraphicsPath camino = Tema.Redondeado(new Rectangle(0, 0, Width - 1, Height - 1), 12))
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                e.Graphics.DrawPath(lapiz, camino);
            }
        }
    }
}
