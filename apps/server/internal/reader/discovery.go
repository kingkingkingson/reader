package reader

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// DiscoveryFile tells the `reader` command line where the running server
// listens. It holds the API token, so only the owner may read it. A file left
// behind by a crash points at a closed port, which the command line reports as
// Reader not running.
const DiscoveryFile = "server.json"

type Discovery struct {
	URL     string `json:"url"`
	Token   string `json:"token"`
	PID     int    `json:"pid"`
	Version string `json:"version"`
}

// WriteDiscovery publishes d in the library directory and returns a function
// that removes it again, unless another server has replaced it since.
func WriteDiscovery(root string, d Discovery) (func(), error) {
	data, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(root, DiscoveryFile)
	temp, err := os.CreateTemp(root, "server-*.json")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	if err = temp.Chmod(0600); err == nil {
		_, err = temp.Write(data)
	}
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temp.Name(), path)
	}
	if err != nil {
		return nil, err
	}
	return func() {
		var current Discovery
		if data, err := os.ReadFile(path); err == nil && json.Unmarshal(data, &current) == nil && current.PID == d.PID && current.URL == d.URL {
			_ = os.Remove(path)
		}
	}, nil
}
