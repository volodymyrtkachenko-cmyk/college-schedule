import os
import subprocess
import datetime
import argparse

def create_backup(output_dir="backups"):
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("Error: DATABASE_URL environment variable is missing.")
        exit(1)

    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = os.path.join(output_dir, f"backup_{timestamp}.sql.gz")

    try:
        # Check pg_dump version first
        version_result = subprocess.run(["pg_dump", "--version"], capture_output=True, text=True, check=True)
        print(f"Using {version_result.stdout.strip()}")
    except FileNotFoundError:
        print("Error: pg_dump not found. Ensure postgresql-client is installed.")
        exit(127)

    # Run pg_dump and gzip the output
    print(f"Starting backup to {output_file}...")
    
    # Use PGPASSWORD trick if URL parsing is tricky, but pg_dump accepts connection strings directly!
    # Strip pooler / pgbouncer specific args if needed, but standard connection string is fine
    dump_cmd = ["pg_dump", "-d", db_url, "--clean", "--if-exists", "--no-owner", "--no-privileges"]
    
    try:
        with open(output_file, "wb") as f_out:
            # Pipe to gzip
            p1 = subprocess.Popen(dump_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            p2 = subprocess.Popen(["gzip", "-c"], stdin=p1.stdout, stdout=f_out)
            p1.stdout.close()
            p2.communicate()
            
            p1.wait()
            if p1.returncode != 0:
                print(f"Error during pg_dump: {p1.stderr.read().decode('utf-8')}")
                exit(p1.returncode)
                
            print(f"Backup completed successfully: {output_file}")
            
            # Print file size
            size_mb = os.path.getsize(output_file) / (1024 * 1024)
            print(f"Size: {size_mb:.2f} MB")
            
    except Exception as e:
        print(f"Backup failed: {e}")
        exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a PostgreSQL database backup.")
    parser.add_argument("--dir", default="/data/backups", help="Directory to save the backup")
    args = parser.parse_args()
    
    create_backup(args.dir)
