package nebulaekno;

import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.ofdrw.reader.OFDReader;
import org.ofdrw.converter.ImageMaker;

/** Rasterize source pages, in order, without extracting/reflowing text. */
public final class OfdRenderer {
    public static void main(String[] args) throws Exception {
        if (args.length == 1 && args[0].equals("--version")) {
            Class.forName("org.slf4j.LoggerFactory");
            Class.forName("org.ofdrw.converter.ImageMaker");
            Class.forName("com.itextpdf.kernel.colors.Color");
            System.out.println("NebulaeKno OFD renderer / OFDRW 2.4.0");
            return;
        }
        if (args.length != 2) throw new IllegalArgumentException("OFD_RENDER_ARGUMENTS");
        Path destination = Path.of(args[1]);
        Files.createDirectories(destination);
        try (OFDReader reader = new OFDReader(Path.of(args[0]))) {
            int count = reader.getNumberOfPages();
            if (count < 1 || count > 3000) throw new IllegalArgumentException("OFD_PAGE_LIMIT");
            System.out.printf("{\"total\":%d,\"completed\":0}%n", count);
            for (int i = 0; i < count; i++) {
                var box = reader.getPageInfo(i + 1).getSize();
                double width = box.getWidth(), height = box.getHeight();
                if (!Double.isFinite(width) || !Double.isFinite(height) || width <= 0 || height <= 0)
                    throw new IllegalArgumentException("OFD_PAGE_SIZE_INVALID");
                // Up to 240 DPI, bounded to 3200 pixels along the long edge.
                double ppm = Math.min(240.0 / 25.4, 3200.0 / Math.max(width, height));
                BufferedImage image = new ImageMaker(reader, ppm).makePage(i);
                Path file = destination.resolve(String.format("ofd-page-%04d.png", i + 1));
                if (!ImageIO.write(image, "PNG", file.toFile())) throw new IllegalStateException("OFD_IMAGE_WRITE_FAILED");
                image.flush();
                System.out.printf(java.util.Locale.ROOT,
                    "{\"total\":%d,\"completed\":%d,\"width_mm\":%.6f,\"height_mm\":%.6f}%n", count, i + 1, width, height);
            }
        }
    }
}
