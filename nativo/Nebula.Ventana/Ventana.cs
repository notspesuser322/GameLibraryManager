using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Nebula.Ventana
{
    /// <summary>
    /// La ventana de Nébula.
    ///
    /// Es una ventana de Windows normal: se abre, muestra el icono del programa en
    /// la barra de tareas y se cierra con la X, como cualquier programa. Dentro,
    /// WebView2 dibuja la interfaz (que es la de siempre) y mientras el núcleo
    /// arranca se ve el nombre del programa y un aviso de que está empezando.
    ///
    /// Al cerrarla, el núcleo se apaga con ella: no queda nada corriendo por
    /// detrás salvo que haya un juego en marcha, y en ese caso termina solo cuando
    /// el juego acabe (para no perder el tiempo jugado).
    /// </summary>
    internal sealed class Ventana : Form
    {
        private readonly int puerto;
        private readonly Nucleo nucleo;
        private readonly bool keepAlive;
        private readonly string carpetaDatos;
        private readonly WebView2 navegador;
        private readonly Label aviso;
        private readonly Timer reloj;
        private int intentos;
        private bool navegando;
        private bool mantenerNucleo;   /* si la interfaz se abre fuera, el motor se queda */

        public Ventana(int puerto, Nucleo nucleo, bool keepAlive, string carpetaDatos)
        {
            this.puerto = puerto;
            this.nucleo = nucleo;
            this.keepAlive = keepAlive;
            this.carpetaDatos = carpetaDatos;

            Text = "Nébula";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(940, 620);
            Size = new Size(1180, 760);
            BackColor = Color.FromArgb(11, 13, 18);
            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { /* sin icono propio: Windows pone el suyo */ }

            aviso = new Label();
            aviso.Dock = DockStyle.Fill;
            aviso.TextAlign = ContentAlignment.MiddleCenter;
            aviso.ForeColor = Color.FromArgb(200, 206, 220);
            aviso.Font = new Font("Segoe UI", 12F, FontStyle.Regular);
            aviso.Text = "Abriendo Nébula…";

            navegador = new WebView2();
            navegador.Dock = DockStyle.Fill;
            navegador.Visible = false;
            navegador.DefaultBackgroundColor = Color.FromArgb(11, 13, 18);

            Controls.Add(navegador);
            Controls.Add(aviso);
            aviso.BringToFront();

            reloj = new Timer();
            reloj.Interval = 500;
            reloj.Tick += RevisarArranque;
        }

        protected override async void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try
            {
                CoreWebView2Environment entorno = await CoreWebView2Environment.CreateAsync(
                    null, Nucleo.CarpetaWebView2(carpetaDatos));
                await navegador.EnsureCoreWebView2Async(entorno);

                // la ventana se comporta como un programa, no como un navegador
                CoreWebView2 ajustes = navegador.CoreWebView2;
                ajustes.Settings.AreDefaultContextMenusEnabled = false;
                ajustes.Settings.IsZoomControlEnabled = false;
                ajustes.Settings.AreDevToolsEnabled = false;
                ajustes.Settings.IsStatusBarEnabled = false;
                ajustes.NewWindowRequested += AlPedirVentanaNueva;

                reloj.Start();
            }
            catch (Exception error)
            {
                Salida.Error("no se pudo preparar el motor de dibujo (WebView2): " + error.Message);
                DialogResult respuesta = MessageBox.Show(
                    "No se pudo abrir la ventana de Nébula.\n\n" +
                    "Falta el componente WebView2 (viene con Microsoft Edge).\n" +
                    "¿Quieres abrir la biblioteca en el navegador?",
                    "Nébula", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (respuesta == DialogResult.Yes)
                {
                    /* la biblioteca se abre fuera: el motor tiene que seguir vivo */
                    mantenerNucleo = true;
                    AbrirFuera("http://127.0.0.1:" + puerto + "/");
                }
                Close();
            }
        }

        /// <summary>Los enlaces de fuera (créditos, fuentes) se abren en el navegador.</summary>
        private void AlPedirVentanaNueva(object remitente, CoreWebView2NewWindowRequestedEventArgs evento)
        {
            evento.Handled = true;
            AbrirFuera(evento.Uri);
        }

        private static void AbrirFuera(string direccion)
        {
            try
            {
                Process.Start(new ProcessStartInfo(direccion) { UseShellExecute = true });
            }
            catch (Exception error)
            {
                Salida.Error("no se pudo abrir el navegador: " + error.Message);
            }
        }

        /// <summary>Espera a que el núcleo responda y entonces enseña la interfaz.</summary>
        private void RevisarArranque(object remitente, EventArgs e)
        {
            intentos++;
            if (Nucleo.Saludable(puerto))
            {
                reloj.Stop();
                if (navegando) return;
                navegando = true;
                aviso.Text = "Un momento…";
                navegador.Visible = true;
                navegador.BringToFront();
                navegador.Source = new Uri("http://127.0.0.1:" + puerto + "/");
                return;
            }

            if (!nucleo.Vivo)
            {
                reloj.Stop();
                aviso.Text = "El programa se cerró inesperadamente.\nMira Nebula.log en la carpeta de datos.";
                Salida.Error("el nucleo terminó antes de responder");
                return;
            }

            if (intentos == 40) aviso.Text = "Nébula está tardando en arrancar… (revisa la carpeta de datos)";
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            reloj.Stop();
            /* se le da al núcleo un margen para guardar los datos y salir con orden */
            nucleo.Cerrar(puerto, keepAlive || mantenerNucleo, 8000);
            nucleo.Dispose();
        }
    }
}
