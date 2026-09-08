'use strict';

/**
 * app.js - Lógica del frontend del Metadata Editor Pro.
 *
 * Se comunica con el backend Express mediante URLs relativas (/api/metadata/...)
 * de modo que funciona cuando los archivos estáticos son servidos por el mismo
 * servidor.
 */

(function () {
    var API_BASE = '/api/metadata';

    // Extensiones/MIME reconocidos.
    var IMAGE_EXT = ['jpg', 'jpeg', 'png', 'tiff', 'tif'];
    var VIDEO_EXT = ['mp4', 'mov', 'avi', 'm4v', 'mkv'];

    // Estado del editor.
    var state = {
        file: null,
        previewUrl: null,
        selectedTemplate: null,
        customJson: null,
        downloadUrl: null
    };

    // ---------------------------------------------------------------------
    // Utilidades
    // ---------------------------------------------------------------------

    function $(id) {
        return document.getElementById(id);
    }

    /**
     * Convierte bytes a un tamaño legible por humanos.
     * @param {number} bytes
     * @returns {string}
     */
    function humanFileSize(bytes) {
        if (!bytes && bytes !== 0) {
            return '';
        }
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = 0;
        var size = bytes;
        while (size >= 1024 && i < units.length - 1) {
            size /= 1024;
            i += 1;
        }
        return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    /**
     * Devuelve la extensión en minúsculas de un nombre de archivo.
     * @param {string} name
     * @returns {string}
     */
    function getExt(name) {
        var idx = name.lastIndexOf('.');
        return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
    }

    /**
     * Determina si un archivo es imagen (por MIME o extensión).
     * @param {File} file
     * @returns {boolean}
     */
    function isImage(file) {
        if (file.type && file.type.indexOf('image/') === 0) {
            return true;
        }
        return IMAGE_EXT.indexOf(getExt(file.name)) !== -1;
    }

    /**
     * Determina si un archivo es video (por MIME o extensión).
     * @param {File} file
     * @returns {boolean}
     */
    function isVideo(file) {
        if (file.type && file.type.indexOf('video/') === 0) {
            return true;
        }
        return VIDEO_EXT.indexOf(getExt(file.name)) !== -1;
    }

    // ---------------------------------------------------------------------
    // Tabs
    // ---------------------------------------------------------------------

    function initTabs() {
        var buttons = document.querySelectorAll('.tab-btn');
        buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var tab = btn.getAttribute('data-tab');

                document.querySelectorAll('.tab-btn').forEach(function (b) {
                    b.classList.remove('active');
                });
                document.querySelectorAll('.tab-content').forEach(function (c) {
                    c.classList.remove('active');
                });

                btn.classList.add('active');
                var content = $(tab + '-tab');
                if (content) {
                    content.classList.add('active');
                }
            });
        });
    }

    // ---------------------------------------------------------------------
    // Drag & drop helper
    // ---------------------------------------------------------------------

    /**
     * Cablea una zona de subida con click + drag & drop hacia un input file.
     * @param {HTMLElement} zone
     * @param {HTMLInputElement} input
     * @param {function(File):void} onFile callback con el archivo elegido
     */
    function wireDropZone(zone, input, onFile) {
        if (!zone || !input) {
            return;
        }

        zone.addEventListener('click', function () {
            input.click();
        });

        input.addEventListener('change', function () {
            if (input.files && input.files[0]) {
                onFile(input.files[0]);
            }
        });

        ['dragenter', 'dragover'].forEach(function (evt) {
            zone.addEventListener(evt, function (e) {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('dragover');
            });
        });

        ['dragleave', 'dragend', 'drop'].forEach(function (evt) {
            zone.addEventListener(evt, function (e) {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('dragover');
            });
        });

        zone.addEventListener('drop', function (e) {
            var dt = e.dataTransfer;
            if (dt && dt.files && dt.files[0]) {
                onFile(dt.files[0]);
            }
        });
    }

    // ---------------------------------------------------------------------
    // Edit tab
    // ---------------------------------------------------------------------

    function showFilePreview(file) {
        state.file = file;

        var previewContainer = $('preview-container');
        var filenameEl = $('filename');
        var filesizeEl = $('filesize');

        filenameEl.textContent = file.name;
        filesizeEl.textContent = humanFileSize(file.size);

        // Limpiar preview anterior.
        previewContainer.innerHTML = '';
        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
            state.previewUrl = null;
        }

        if (isImage(file)) {
            state.previewUrl = URL.createObjectURL(file);
            var img = document.createElement('img');
            img.src = state.previewUrl;
            img.alt = file.name;
            previewContainer.appendChild(img);
        } else {
            var placeholder = document.createElement('div');
            placeholder.className = 'preview-placeholder';
            placeholder.textContent = isVideo(file) ? '🎬' : '📄';
            previewContainer.appendChild(placeholder);
        }

        $('file-preview').style.display = 'flex';
        $('device-selector').style.display = 'block';
        $('custom-metadata').style.display = 'block';

        var processBtn = $('process-btn');
        processBtn.style.display = 'flex';
        processBtn.disabled = false;

        // Nuevo archivo: ocultar resultado previo.
        $('result-section').style.display = 'none';
    }

    function resetEditFile() {
        state.file = null;
        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
            state.previewUrl = null;
        }
        $('preview-container').innerHTML = '';
        $('file-preview').style.display = 'none';
        $('device-selector').style.display = 'none';
        $('custom-metadata').style.display = 'none';

        var processBtn = $('process-btn');
        processBtn.style.display = 'none';
        processBtn.disabled = true;

        var fileInput = $('file-input');
        if (fileInput) {
            fileInput.value = '';
        }
        $('result-section').style.display = 'none';
    }

    function initEditTab() {
        wireDropZone($('upload-zone'), $('file-input'), showFilePreview);

        var removeBtn = $('remove-file');
        if (removeBtn) {
            removeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                resetEditFile();
            });
        }

        var processBtn = $('process-btn');
        if (processBtn) {
            processBtn.addEventListener('click', processFile);
        }
    }

    // ---------------------------------------------------------------------
    // Templates (device grid)
    // ---------------------------------------------------------------------

    function renderDeviceCards(templates) {
        var grid = $('device-grid');
        grid.innerHTML = '';

        templates.forEach(function (tpl) {
            var card = document.createElement('div');
            card.className = 'device-card';
            card.setAttribute('data-id', tpl.id);

            var icon = document.createElement('span');
            icon.className = 'device-icon';
            icon.textContent = tpl.icon || '📦';

            var name = document.createElement('span');
            name.className = 'device-name';
            name.textContent = tpl.name || tpl.id;

            card.appendChild(icon);
            card.appendChild(name);

            card.addEventListener('click', function () {
                var already = card.classList.contains('selected');
                document.querySelectorAll('.device-card').forEach(function (c) {
                    c.classList.remove('selected');
                });
                if (already) {
                    state.selectedTemplate = null;
                } else {
                    card.classList.add('selected');
                    state.selectedTemplate = tpl.id;
                }
            });

            grid.appendChild(card);
        });
    }

    function loadTemplates() {
        fetch(API_BASE + '/templates')
            .then(function (res) {
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status);
                }
                return res.json();
            })
            .then(function (data) {
                var list = (data && data.templates) || [];
                renderDeviceCards(list);
            })
            .catch(function (err) {
                var grid = $('device-grid');
                if (grid) {
                    grid.innerHTML =
                        '<p class="tree-empty">No se pudieron cargar las plantillas: ' +
                        err.message + '</p>';
                }
            });
    }

    // ---------------------------------------------------------------------
    // Procesar archivo (edit-image / edit-video)
    // ---------------------------------------------------------------------

    function setProcessing(isProcessing) {
        var btn = $('process-btn');
        var spinner = btn.querySelector('.spinner');
        var text = btn.querySelector('.btn-text');
        btn.disabled = isProcessing;
        if (spinner) {
            spinner.style.display = isProcessing ? 'inline-block' : 'none';
        }
        if (text) {
            text.textContent = isProcessing ? 'Procesando...' : 'Procesar Archivo';
        }
    }

    /**
     * Muestra (o limpia) un aviso en la seccion de resultado indicando que
     * campos de metadata se aplicaron al video y cuales se ignoraron, ya que los
     * contenedores de video solo soportan un subconjunto de los tags EXIF.
     * @param {boolean} isVideoFile si el archivo procesado era video
     * @param {string} applied lista separada por comas de tags aplicados
     * @param {string} ignored lista separada por comas de tags ignorados
     */
    function showVideoMetaNote(isVideoFile, applied, ignored) {
        var resultSection = $('result-section');
        if (!resultSection) {
            return;
        }

        var note = resultSection.querySelector('.video-note');

        // Solo aplica a video; para imagen limpiamos cualquier aviso previo.
        if (!isVideoFile) {
            if (note) {
                note.parentNode.removeChild(note);
            }
            return;
        }

        if (!note) {
            note = document.createElement('div');
            note.className = 'video-note';
            resultSection.appendChild(note);
        }

        var appliedList = applied ? applied.split(',').filter(Boolean) : [];
        var ignoredList = ignored ? ignored.split(',').filter(Boolean) : [];

        var parts = [];
        parts.push('<strong>Nota sobre metadata de video:</strong> los contenedores ' +
            'MP4/MOV/AVI solo admiten un subconjunto de campos EXIF.');
        if (appliedList.length) {
            parts.push('Aplicados: ' + appliedList.join(', ') + '.');
        } else {
            parts.push('No se aplico ningun campo mapeable al contenedor.');
        }
        if (ignoredList.length) {
            parts.push('Ignorados (no soportados por el contenedor): ' +
                ignoredList.join(', ') + '.');
        }
        note.innerHTML = parts.join(' ');
    }

    function processFile() {
        if (!state.file) {
            return;
        }

        var form = new FormData();
        form.append('file', state.file);

        if (state.selectedTemplate) {
            form.append('template', state.selectedTemplate);
        }

        var fields = {
            make: 'custom-make',
            model: 'custom-model',
            software: 'custom-software',
            date: 'custom-date',
            lat: 'custom-lat',
            lon: 'custom-lon'
        };
        Object.keys(fields).forEach(function (key) {
            var el = $(fields[key]);
            if (el && el.value) {
                form.append(key, el.value);
            }
        });

        // JSON custom validado desde la pestaña Custom.
        if (state.customJson) {
            form.append('custom', JSON.stringify(state.customJson));
        }

        var isVideoFile = isVideo(state.file);
        var endpoint = isVideoFile
            ? API_BASE + '/edit-video'
            : API_BASE + '/edit-image';

        setProcessing(true);
        $('result-section').style.display = 'none';

        // Cabeceras que el backend usa para informar que campos se aplicaron o
        // se ignoraron al editar video (los contenedores no llevan optica EXIF).
        var appliedMeta = '';
        var ignoredMeta = '';

        fetch(endpoint, { method: 'POST', body: form })
            .then(function (res) {
                if (!res.ok) {
                    // Intentamos leer el cuerpo JSON {error:'...'} del backend. Si
                    // el parseo falla (respuesta sin JSON), usamos el fallback de
                    // estado HTTP. Importante: el .catch va SOLO sobre res.json()
                    // para no tragarse el error que lanzamos con el mensaje real.
                    return res
                        .json()
                        .catch(function () {
                            return null;
                        })
                        .then(function (data) {
                            if (data && data.error) {
                                throw new Error(data.error);
                            }
                            throw new Error('Error del servidor (HTTP ' + res.status + ')');
                        });
                }
                appliedMeta = res.headers.get('X-Applied-Metadata') || '';
                ignoredMeta = res.headers.get('X-Ignored-Metadata') || '';
                return res.blob();
            })
            .then(function (blob) {
                if (state.downloadUrl) {
                    URL.revokeObjectURL(state.downloadUrl);
                }
                state.downloadUrl = URL.createObjectURL(blob);

                var link = $('download-link');
                link.href = state.downloadUrl;
                link.setAttribute('download', 'edited-' + state.file.name);

                showVideoMetaNote(isVideoFile, appliedMeta, ignoredMeta);

                $('result-section').style.display = 'block';
            })
            .catch(function (err) {
                alert('No se pudo procesar el archivo: ' + err.message);
            })
            .then(function () {
                setProcessing(false);
            });
    }

    // ---------------------------------------------------------------------
    // Read tab (árbol de metadata)
    // ---------------------------------------------------------------------

    /**
     * Construye recursivamente un nodo del árbol de metadata.
     * @param {string} key
     * @param {*} value
     * @returns {HTMLElement}
     */
    function buildTreeNode(key, value) {
        var node = document.createElement('div');
        node.className = 'tree-node';

        var isObject = value !== null && typeof value === 'object';

        if (isObject) {
            var toggle = document.createElement('span');
            toggle.className = 'tree-toggle';
            toggle.textContent = '▼';

            var keySpan = document.createElement('span');
            keySpan.className = 'tree-key';
            keySpan.textContent = key;

            node.appendChild(toggle);
            node.appendChild(keySpan);

            var children = document.createElement('div');
            children.className = 'tree-children';

            var entries = Array.isArray(value)
                ? value.map(function (v, i) { return ['[' + i + ']', v]; })
                : Object.keys(value).map(function (k) { return [k, value[k]]; });

            if (entries.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'tree-node tree-empty';
                empty.textContent = Array.isArray(value) ? '(vacío)' : '{}';
                children.appendChild(empty);
            } else {
                entries.forEach(function (pair) {
                    children.appendChild(buildTreeNode(pair[0], pair[1]));
                });
            }

            node.appendChild(children);

            toggle.addEventListener('click', function () {
                node.classList.toggle('collapsed');
                toggle.textContent = node.classList.contains('collapsed') ? '▶' : '▼';
            });
        } else {
            var kSpan = document.createElement('span');
            kSpan.className = 'tree-key';
            kSpan.textContent = key + ': ';

            var vSpan = document.createElement('span');
            vSpan.className = 'tree-value';
            vSpan.textContent = String(value);

            node.appendChild(kSpan);
            node.appendChild(vSpan);
        }

        return node;
    }

    function renderMetadataTree(metadata) {
        var tree = $('metadata-tree');
        tree.innerHTML = '';

        if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
            var empty = document.createElement('p');
            empty.className = 'tree-empty';
            empty.textContent = 'No se encontraron metadatos.';
            tree.appendChild(empty);
        } else {
            Object.keys(metadata).forEach(function (key) {
                tree.appendChild(buildTreeNode(key, metadata[key]));
            });
        }

        $('metadata-viewer').style.display = 'block';
    }

    function readFileMetadata(file) {
        var tree = $('metadata-tree');
        tree.innerHTML = '<p class="tree-empty">Analizando metadatos...</p>';
        $('metadata-viewer').style.display = 'block';

        var form = new FormData();
        form.append('file', file);

        fetch(API_BASE + '/read', { method: 'POST', body: form })
            .then(function (res) {
                if (!res.ok) {
                    // El .catch va SOLO sobre res.json() para no tragarse el
                    // error con el mensaje real del backend.
                    return res
                        .json()
                        .catch(function () {
                            return null;
                        })
                        .then(function (data) {
                            if (data && data.error) {
                                throw new Error(data.error);
                            }
                            throw new Error('Error del servidor (HTTP ' + res.status + ')');
                        });
                }
                return res.json();
            })
            .then(function (data) {
                renderMetadataTree(data && data.metadata);
            })
            .catch(function (err) {
                tree.innerHTML =
                    '<p class="tree-empty">No se pudo leer la metadata: ' +
                    err.message + '</p>';
            });
    }

    function initReadTab() {
        wireDropZone($('read-upload-zone'), $('read-file-input'), readFileMetadata);
    }

    // ---------------------------------------------------------------------
    // Custom tab (validación JSON)
    // ---------------------------------------------------------------------

    function ensureJsonFeedback() {
        var existing = document.querySelector('.json-feedback');
        if (existing) {
            return existing;
        }
        var feedback = document.createElement('div');
        feedback.className = 'json-feedback';
        var editor = document.querySelector('.json-editor');
        if (editor) {
            editor.appendChild(feedback);
        }
        return feedback;
    }

    function initCustomTab() {
        var btn = $('validate-json');
        if (!btn) {
            return;
        }
        btn.addEventListener('click', function () {
            var textarea = $('json-metadata');
            var feedback = ensureJsonFeedback();
            var raw = textarea ? textarea.value.trim() : '';

            if (!raw) {
                state.customJson = null;
                feedback.className = 'json-feedback show error';
                feedback.textContent = 'El editor está vacío.';
                return;
            }

            try {
                var parsed = JSON.parse(raw);
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('El JSON debe ser un objeto de pares clave/valor.');
                }
                state.customJson = parsed;
                feedback.className = 'json-feedback show ok';
                feedback.textContent =
                    '✓ JSON válido. Se aplicará al procesar en la pestaña Editar.';
            } catch (err) {
                state.customJson = null;
                feedback.className = 'json-feedback show error';
                feedback.textContent = '✕ JSON inválido: ' + err.message;
            }
        });
    }

    // ---------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------

    function init() {
        initTabs();
        initEditTab();
        initReadTab();
        initCustomTab();
        loadTemplates();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
