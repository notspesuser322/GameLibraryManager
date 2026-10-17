using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Nebula.Ventana
{
    /// <summary>
    /// Colores, fuentes y piezas de dibujo compartidas.
    ///
    /// Toda la interfaz está dibujada por el propio programa con controles de
    /// Windows: no hay ninguna página web dentro. El aspecto sigue siendo el del
    /// tema oscuro de siempre, para que el cambio a nativo no se note en el gusto.
    /// </summary>
    internal static class Tema
    {
        public static readonly Color Fondo = Color.FromArgb(0x0B, 0x0D, 0x12);
        public static readonly Color Panel = Color.FromArgb(0x14, 0x18, 0x26);
        public static readonly Color PanelClaro = Color.FromArgb(0x1B, 0x20, 0x33);
        public static readonly Color Borde = Color.FromArgb(0x25, 0x2B, 0x42);
        public static readonly Color Texto = Color.FromArgb(0xE6, 0xE9, 0xF2);
        public static readonly Color Suave = Color.FromArgb(0x8D, 0x93, 0xA1);
        public static readonly Color Acento = Color.FromArgb(0x7C, 0x9C, 0xFF);
        public static readonly Color AcentoOscuro = Color.FromArgb(0x28, 0x32, 0x55);
        public static readonly Color Verde = Color.FromArgb(0x3D, 0xDC, 0x97);
        public static readonly Color Rojo = Color.FromArgb(0xFF, 0x6B, 0x81);
        public static readonly Color Amarillo = Color.FromArgb(0xFF, 0xC8, 0x57);

        public static readonly Font Titulo = new Font("Segoe UI Semibold", 20F, FontStyle.Bold);
        public static readonly Font Subtitulo = new Font("Segoe UI Semibold", 14F, FontStyle.Bold);
        public static readonly Font Normal = new Font("Segoe UI", 10F);
        public static readonly Font Pequena = new Font("Segoe UI", 9F);
        public static readonly Font Negrita = new Font("Segoe UI Semibold", 10F, FontStyle.Bold);
        public static readonly Font Cifra = new Font("Segoe UI Semibold", 22F, FontStyle.Bold);

        /// <summary>Deja un formulario o vista con el aspecto de la casa.</summary>
        public static void Aplicar(Control control)
        {
            control.BackColor = Fondo;
            control.ForeColor = Texto;
            control.Font = Normal;
        }

        public static Label Etiqueta(string texto, Font fuente = null, Color? color = null)
        {
            Label etiqueta = new Label();
            etiqueta.Text = texto;
            etiqueta.AutoSize = true;
            etiqueta.BackColor = Color.Transparent;
            etiqueta.ForeColor = color ?? Texto;
            etiqueta.Font = fuente ?? Normal;
            return etiqueta;
        }

        public static Button Boton(string texto, bool primario = false, int ancho = 0)
        {
            Button boton = new Button();
            boton.Text = texto;
            boton.AutoSize = ancho <= 0;
            if (ancho > 0)
            {
                boton.AutoSize = false;
                boton.Width = ancho;
                boton.Height = 34;
            }
            boton.FlatStyle = FlatStyle.Flat;
            boton.FlatAppearance.BorderSize = 1;
            boton.FlatAppearance.BorderColor = primario ? Acento : Borde;
            boton.BackColor = primario ? AcentoOscuro : PanelClaro;
            boton.ForeColor = primario ? Color.White : Texto;
            boton.Font = Negrita;
            boton.Padding = new Padding(10, 0, 10, 0);
            boton.Cursor = Cursors.Hand;
            boton.UseVisualStyleBackColor = false;
            boton.Margin = new Padding(0, 0, 8, 0);
            return boton;
        }

        /// <summary>Rectángulo redondeado (para paneles, tarjetas y píldoras).</summary>
        public static GraphicsPath Redondeado(Rectangle caja, int radio)
        {
            GraphicsPath camino = new GraphicsPath();
            int diametro = Math.Max(2, radio * 2);
            if (caja.Width <= diametro || caja.Height <= diametro)
            {
                camino.AddRectangle(caja);
                return camino;
            }
            Rectangle arco = new Rectangle(caja.X, caja.Y, diametro, diametro);
            camino.AddArc(arco, 180, 90);
            arco.X = caja.Right - diametro;
            camino.AddArc(arco, 270, 90);
            arco.Y = caja.Bottom - diametro;
            camino.AddArc(arco, 0, 90);
            arco.X = caja.X;
            camino.AddArc(arco, 90, 90);
            camino.CloseFigure();
            return camino;
        }

        public static void Rellenar(Graphics g, Rectangle caja, int radio, Color relleno, Color? borde = null)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath camino = Redondeado(caja, radio))
            using (SolidBrush pincel = new SolidBrush(relleno))
            {
                g.FillPath(pincel, camino);
                if (borde.HasValue)
                {
                    using (Pen lapiz = new Pen(borde.Value, 1f)) g.DrawPath(lapiz, camino);
                }
            }
        }

        /// <summary>Dibuja una imagen encajada en la caja, sin deformarla.</summary>
        public static void DibujarEncajada(Graphics g, Image imagen, Rectangle caja)
        {
            if (imagen == null) return;
            float escala = Math.Min((float)caja.Width / imagen.Width, (float)caja.Height / imagen.Height);
            int ancho = Math.Max(1, (int)(imagen.Width * escala));
            int alto = Math.Max(1, (int)(imagen.Height * escala));
            Rectangle destino = new Rectangle(caja.X + (caja.Width - ancho) / 2, caja.Y + (caja.Height - alto) / 2, ancho, alto);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(imagen, destino);
        }

        /// <summary>Texto de una sola línea, con puntos suspensivos si no cabe.</summary>
        public static void TextoLinea(Graphics g, string texto, Font fuente, Color color, Rectangle caja, TextFormatFlags extra = TextFormatFlags.Left)
        {
            TextRenderer.DrawText(g, texto ?? string.Empty, fuente, caja, color,
                extra | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }

        /// <summary>Duración en el formato de la casa: «3 h 20 min», «12 min», «45 s».</summary>
        public static string Duracion(long segundos)
        {
            if (segundos < 60) return segundos + " s";
            long minutos = segundos / 60;
            if (minutos < 60) return minutos + " min";
            long horas = minutos / 60;
            long resto = minutos % 60;
            return resto == 0 ? horas + " h" : horas + " h " + resto + " min";
        }

        /// <summary>Tamaño en disco legible.</summary>
        public static string Peso(long bytes)
        {
            if (bytes <= 0) return "—";
            double valor = bytes;
            string[] unidades = { "B", "KB", "MB", "GB", "TB" };
            int unidad = 0;
            while (valor >= 1024 && unidad < unidades.Length - 1)
            {
                valor /= 1024;
                unidad++;
            }
            return valor.ToString(unidad == 0 ? "0" : "0.#") + " " + unidades[unidad];
        }

        /// <summary>Fecha corta legible; devuelve «—» si no hay.</summary>
        public static string Fecha(string iso)
        {
            if (string.IsNullOrEmpty(iso)) return "—";
            DateTime fecha;
            if (DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out fecha))
            {
                return fecha.ToLocalTime().ToString("d MMM yyyy");
            }
            return "—";
        }

        /// <summary>Convierte un color de la API (#rrggbb) en un color de Windows.</summary>
        public static Color DeHex(string hex, Color porDefecto)
        {
            if (string.IsNullOrEmpty(hex)) return porDefecto;
            try
            {
                string limpio = hex.TrimStart('#');
                if (limpio.Length == 6)
                {
                    int rojo = Convert.ToInt32(limpio.Substring(0, 2), 16);
                    int verde = Convert.ToInt32(limpio.Substring(2, 2), 16);
                    int azul = Convert.ToInt32(limpio.Substring(4, 2), 16);
                    return Color.FromArgb(rojo, verde, azul);
                }
            }
            catch { /* color raro: se usa el de por defecto */ }
            return porDefecto;
        }
    }
}
