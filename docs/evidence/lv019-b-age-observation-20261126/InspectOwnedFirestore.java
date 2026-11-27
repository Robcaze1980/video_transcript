import com.google.cloud.datastore.emulator.cli.FirestoreEmulatorCliOptions;
import com.google.cloud.datastore.emulator.firestore.CloudFirestore;
import com.google.cloud.datastore.emulator.firestore.CloudFirestoreEmulatorOption;
import io.gapi.emulators.grpc.GrpcServer;
import io.grpc.Server;
import io.netty.util.ResourceLeakDetector;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

// Adapted from the locally inspected 1.21.0 metadata fixture; never connects to a cloud project.
public final class InspectOwnedFirestore {
  private static final String HOST = "127.0.0.1";
  private static final String PROJECT = "demo-vistavo-admission";

  private static Object field(Object target, Class<?> declaringClass, String name) throws Exception {
    var field = declaringClass.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(target);
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 4 || !args[2].matches("[a-f0-9-]{36}")) {
      throw new IllegalArgumentException("Expected ready, stop, run nonce and rules paths");
    }
    var ready = Path.of(args[0]).toAbsolutePath();
    var stop = Path.of(args[1]).toAbsolutePath();
    var rules = Path.of(args[3]).toRealPath();
    if (!ready.getParent().equals(stop.getParent()) || Files.exists(ready) || Files.exists(stop) || !Files.isRegularFile(rules)) {
      throw new IllegalArgumentException("Expected fresh paths and local rules");
    }
    var cli = FirestoreEmulatorCliOptions.parse(new String[] {
      "--host", HOST, "--port", "8197", "--websocket_port", "9197", "--webchannel_port", "9297",
      "--project_id", PROJECT, "--single_project_mode", "true", "--single_project_mode_error", "true",
      "--rules", rules.toString()
    });
    var convert = CloudFirestore.class.getDeclaredMethod("convertCliOptions", FirestoreEmulatorCliOptions.class);
    convert.setAccessible(true);
    var options = (CloudFirestoreEmulatorOption) convert.invoke(null, cli);
    ResourceLeakDetector.setLevel(ResourceLeakDetector.Level.DISABLED);
    var emulator = CloudFirestore.startLocally(options);
    try {
      var proxy = (GrpcServer) field(emulator, CloudFirestore.class, "server");
      var backend = (Server) field(proxy, GrpcServer.class, "server");
      var sockets = backend.getListenSockets();
      if (sockets.size() != 1 || !(sockets.get(0) instanceof InetSocketAddress endpoint)
          || endpoint.isUnresolved() || !endpoint.getAddress().isLoopbackAddress()
          || !HOST.equals(endpoint.getAddress().getHostAddress()) || endpoint.getPort() <= 0
          || backend.getPort() != endpoint.getPort()) {
        throw new IllegalStateException("Unexpected gRPC backend listener");
      }
      var pending = ready.resolveSibling(ready.getFileName() + ".pending");
      Files.writeString(pending, String.format("%s%n%d%n%s%n%s%n%d%n", args[2],
          ProcessHandle.current().pid(), PROJECT, HOST, endpoint.getPort()), StandardOpenOption.CREATE_NEW);
      Files.move(pending, ready, StandardCopyOption.ATOMIC_MOVE);
      while (!Files.exists(stop)) Thread.sleep(25);
      if (!args[2].equals(Files.readString(stop))) throw new IllegalStateException("Stop nonce does not match");
    } finally {
      emulator.stop();
    }
  }
}
